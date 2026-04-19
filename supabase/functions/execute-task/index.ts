// Execute a task or thread follow-up.
//
// Modes:
//   1. Legacy: { task_id }            → run AI on a work_task, write back into work_tasks
//   2. Thread: { thread_id, follow_up? } → run AI on a chat_sessions thread, persist
//                                          messages into chat_messages and outputs into artifacts
//
// In thread mode the function:
//   - Loads the full message history for context
//   - Persists the user follow-up (if provided) into chat_messages
//   - Streams the AI response from /chat, accumulating SSE deltas
//   - Inserts a new chat_messages row for the assistant turn
//   - Detects deliverable type heuristically and writes a typed artifact
//   - Updates thread.current_artifact_id + task_status

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

interface ActivityEntry {
  timestamp: string;
  action: string;
  detail: string;
  actor: string;
  status?: string;
}

// ── SSE accumulation helper (shared) ──────────────────────────────
async function streamChat(messages: Array<{ role: string; content: string }>, userId: string, systemContext: string) {
  const chatRes = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ messages, userId, enableTools: true, systemContext }),
  });

  if (!chatRes.ok || !chatRes.body) {
    const errText = await chatRes.text().catch(() => "");
    throw new Error(`Chat ${chatRes.status}: ${errText.slice(0, 300)}`);
  }

  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      for (const line of evt.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string") output += delta;
          const fullMsg = json?.choices?.[0]?.message?.content;
          if (typeof fullMsg === "string" && !delta) output += fullMsg;
        } catch { /* ignore non-JSON metadata */ }
      }
    }
  }

  return output.trim() || "(no output)";
}

// ── Heuristic: detect artifact type from text ─────────────────────
function detectArtifactType(text: string, goal: string | null): { type: string; content: Record<string, unknown>; title: string } {
  const t = text.trim();
  const g = (goal ?? '').toLowerCase();

  // Email draft pattern: starts with Subject: or has To: / Subject:
  const subjMatch = t.match(/^Subject:\s*(.+)$/im);
  const toMatch = t.match(/^To:\s*(.+)$/im);
  if (subjMatch || (g.includes('email') && t.length > 50)) {
    const body = t.replace(/^(To|Subject|From|Cc|Bcc):\s*.+$/gim, '').trim();
    return {
      type: 'email_draft',
      title: subjMatch?.[1]?.trim() ?? 'Email draft',
      content: {
        to: toMatch?.[1]?.trim() ?? null,
        subject: subjMatch?.[1]?.trim() ?? null,
        body,
        text: t,
      },
    };
  }

  // Checklist pattern: 3+ bullet/numbered list items
  const bulletLines = t.split('\n').filter((l) => /^\s*([-*]|\d+\.)\s+/.test(l));
  if (bulletLines.length >= 3 && bulletLines.length / Math.max(t.split('\n').length, 1) > 0.5) {
    const items = bulletLines.map((l) => ({ title: l.replace(/^\s*([-*]|\d+\.)\s+/, '').trim(), done: false }));
    return { type: 'checklist', title: goal ?? 'Checklist', content: { items, text: t } };
  }

  // Default: markdown document
  return { type: 'markdown', title: goal ?? 'Response', content: { text: t } };
}

// ── Mode: thread (unified) ────────────────────────────────────────
async function executeThread(threadId: string, followUp?: string) {
  const { data: thread, error: tErr } = await admin
    .from('chat_sessions')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();
  if (tErr || !thread) return { success: false, error: 'Thread not found' };

  // Load history
  const { data: history } = await admin
    .from('chat_messages')
    .select('role, content, id')
    .eq('session_id', threadId)
    .order('created_at', { ascending: true });

  // Persist user follow-up if provided
  if (followUp?.trim()) {
    await admin.from('chat_messages').insert({
      session_id: threadId,
      user_id: thread.user_id,
      role: 'user',
      content: followUp.trim(),
    });
  }

  // Mark as working
  await admin.from('chat_sessions').update({
    task_status: 'working',
    kind: thread.kind === 'chat' ? 'both' : (thread.kind ?? 'task'),
    updated_at: new Date().toISOString(),
  }).eq('id', threadId);

  await admin.from('task_events').insert({
    user_id: thread.user_id,
    conversation_id: threadId,
    event_type: 'execution_started',
    detail: followUp ? 'Follow-up received' : 'AI continuing work',
  });

  try {
    const goal = thread.goal ?? thread.title ?? 'this conversation';
    const systemContext =
      `You are autonomously executing a task for the user. Goal: "${goal}".\n\n` +
      `RULES:\n` +
      `1. PRODUCE THE DELIVERABLE NOW. Do not ask for confirmation. Do not say "Understood" or "I'll get started" — just do the work and output the result.\n` +
      `2. Use any tools needed (web search, integrations, knowledge base) to actually complete the goal.\n` +
      `3. Output a complete, usable result: a research report, a draft email, a checklist, a document — whatever the goal requires.\n` +
      `4. If the goal is research, return findings with sources. If it's a draft, return the full draft text. If it's a list, return the full list.\n` +
      `5. Only ask the user a question if it is absolutely impossible to proceed without missing input. Otherwise, make reasonable assumptions and deliver.\n` +
      `6. Be thorough but concise. No filler, no preamble. Lead with the deliverable.`;

    const msgs = [
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
      ...(followUp ? [{ role: 'user', content: followUp.trim() }] : []),
    ];

    const output = await streamChat(msgs, thread.user_id, systemContext);

    // Persist assistant message
    const { data: assistantMsg } = await admin.from('chat_messages').insert({
      session_id: threadId,
      user_id: thread.user_id,
      role: 'assistant',
      content: output,
    }).select().single();

    // Build typed artifact
    const detected = detectArtifactType(output, goal);
    const { data: existing } = await admin
      .from('artifacts')
      .select('version')
      .eq('conversation_id', threadId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (existing?.version ?? 0) + 1;

    const { data: artifact } = await admin.from('artifacts').insert({
      user_id: thread.user_id,
      conversation_id: threadId,
      message_id: assistantMsg?.id ?? null,
      version: nextVersion,
      type: detected.type,
      title: detected.title,
      content: detected.content,
      created_by: 'ai',
      status: 'draft',
    }).select().single();

    // Update thread pointer + status
    await admin.from('chat_sessions').update({
      current_artifact_id: artifact?.id ?? null,
      task_status: 'awaiting_user',
      updated_at: new Date().toISOString(),
    }).eq('id', threadId);

    // Mirror back into work_tasks if linked (so kanban stays in sync)
    if (thread.linked_work_task_id) {
      await admin.from('work_tasks').update({
        draft_output: output,
        status: 'up_for_review',
        ai_status: 'waiting',
        next_action: 'needs_review',
        last_activity_at: new Date().toISOString(),
      }).eq('id', thread.linked_work_task_id);
    }

    await admin.from('task_events').insert({
      user_id: thread.user_id,
      conversation_id: threadId,
      event_type: 'execution_completed',
      detail: 'Output ready for review',
      metadata: { artifact_id: artifact?.id, type: detected.type, version: nextVersion },
    });

    return { success: true, artifact_id: artifact?.id, output };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('chat_sessions').update({
      task_status: 'blocked', updated_at: new Date().toISOString(),
    }).eq('id', threadId);
    await admin.from('task_events').insert({
      user_id: thread.user_id,
      conversation_id: threadId,
      event_type: 'execution_error',
      detail: msg.slice(0, 500),
    });
    return { success: false, error: msg };
  }
}

// ── Mode: legacy work_task ────────────────────────────────────────
async function appendActivity(taskId: string, currentLog: ActivityEntry[], entry: ActivityEntry, patch: Record<string, unknown> = {}) {
  const next = [...(currentLog || []), entry];
  await admin.from('work_tasks').update({
    ai_activity_log: next,
    last_activity_at: new Date().toISOString(),
    ...patch,
  }).eq('id', taskId);
  return next;
}

async function executeLegacyTask(taskId: string) {
  const { data: task, error: tErr } = await admin
    .from('work_tasks').select('*').eq('id', taskId).maybeSingle();
  if (tErr || !task) return { success: false, error: 'Task not found' };

  // Find or create paired thread
  let threadId: string;
  const { data: existingThread } = await admin
    .from('chat_sessions').select('id').eq('linked_work_task_id', taskId).maybeSingle();
  if (existingThread) {
    threadId = existingThread.id;
  } else {
    const { data: newThread } = await admin.from('chat_sessions').insert({
      user_id: task.user_id,
      title: task.title,
      kind: 'task',
      goal: task.title,
      task_status: 'working',
      priority: task.priority,
      linked_work_task_id: taskId,
      metadata: { source: 'work_tasks_auto', task_type: task.task_type, intent_type: task.intent_type },
    }).select().single();
    threadId = newThread!.id;

    // Seed initial user message from task description
    const seed = [task.title, task.description].filter(Boolean).join('\n\n');
    await admin.from('chat_messages').insert({
      session_id: threadId,
      user_id: task.user_id,
      role: 'user',
      content: seed,
    });
  }

  let log: ActivityEntry[] = Array.isArray(task.ai_activity_log) ? (task.ai_activity_log as ActivityEntry[]) : [];
  log = await appendActivity(taskId, log, {
    timestamp: new Date().toISOString(),
    action: 'execution_started',
    detail: 'AI picked up the task and started working.',
    actor: 'ai',
    status: 'executing',
  }, { status: 'in_progress', ai_status: 'executing', next_action: 'waiting_on_ai' });

  // Delegate to thread executor (handles streaming + artifact + mirror back)
  const result = await executeThread(threadId);

  if (!result.success) {
    await appendActivity(taskId, log, {
      timestamp: new Date().toISOString(),
      action: 'execution_failed',
      detail: result.error ?? 'Unknown error',
      actor: 'ai',
      status: 'failed',
    }, { ai_status: 'error', next_action: 'waiting_on_human' });
    return result;
  }

  await appendActivity(taskId, log, {
    timestamp: new Date().toISOString(),
    action: 'execution_completed',
    detail: 'AI finished. Output ready for your review.',
    actor: 'ai',
    status: 'completed',
  }, { /* status patched by thread executor mirror */ });

  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const threadId = body.thread_id ?? body.threadId;
    const taskId = body.task_id ?? body.taskId;
    const followUp = body.follow_up ?? body.followUp;

    let result;
    if (threadId) {
      result = await executeThread(threadId, followUp);
    } else if (taskId) {
      result = await executeLegacyTask(taskId);
    } else {
      return new Response(JSON.stringify({ error: 'thread_id or task_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
