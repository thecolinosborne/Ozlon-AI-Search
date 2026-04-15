import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';
const AI_MARKER = '[AI]';
const TRIGGER_PATTERNS = [/@ai\b/i, /@pm\b/i, /@wisdom\b/i];

// ============================================================================
// PM SYSTEM PROMPT
// ============================================================================
const PM_SYSTEM_PROMPT = `You are acting as a project manager inside ClickUp.
Your job is to help move work forward clearly and practically.
Prioritize clarity, execution, prioritization, dependency awareness, and concise action.
When replying in ClickUp:
- be concise but useful
- structure responses for task execution
- identify next steps clearly
- call out blockers and dependencies when relevant
- do not fabricate project facts
- separate facts from suggestions
- avoid unnecessary fluff
- only take direct task-changing actions when explicitly requested
- optimize for helping a team complete work efficiently`;

// ============================================================================
// HELPERS
// ============================================================================

function getToken(tokenOverride?: string): string {
  const token = tokenOverride || Deno.env.get('CLICKUP_API_TOKEN');
  if (!token) throw new Error('CLICKUP_API_TOKEN not configured');
  return token;
}

async function resolveTeamId(
  token: string,
  explicitTeamId?: string
): Promise<{ teamId: string; teams: Array<{ id: string; name: string }> }> {
  const fromParam = explicitTeamId?.trim();
  if (fromParam) return { teamId: fromParam, teams: [] };

  const fromEnv = Deno.env.get('CLICKUP_TEAM_ID');
  if (fromEnv) return { teamId: fromEnv, teams: [] };

  const teamRes = await fetch(`${CLICKUP_BASE}/team`, {
    headers: { 'Authorization': token },
  });
  if (!teamRes.ok) {
    const text = await teamRes.text();
    throw new Error(`Unable to resolve ClickUp team (${teamRes.status}): ${text}`);
  }
  const teamData = await teamRes.json();
  const teams = (teamData?.teams || []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));
  if (!teams.length) throw new Error('No ClickUp teams available for this token');
  return { teamId: teams[0].id, teams };
}

async function getListId(params?: Record<string, unknown>): Promise<string> {
  // Priority: explicit param → DB config → env var
  if (params?.listId) return String(params.listId);
  if (params?.defaultListId) return String(params.defaultListId);
  
  // Check DB for saved default_list_id
  try {
    const supabase = getSupabase();
    const requestedTeamId = String(params?.teamId || '');
    let query = supabase
      .from('clickup_integration_state')
      .select('default_list_id')
      .not('default_list_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (requestedTeamId) query = query.eq('team_id', requestedTeamId);
    const { data } = await query.maybeSingle();
    if (data?.default_list_id) return data.default_list_id;
  } catch { /* fall through */ }
  
  return Deno.env.get('CLICKUP_DEFAULT_LIST_ID') || '';
}

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

async function clickupFetch(path: string, method = 'GET', body?: unknown, tokenOverride?: string) {
  const token = getToken(tokenOverride);
  const opts: RequestInit = {
    method,
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${CLICKUP_BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp API ${res.status}: ${text}`);
  }
  return res.json();
}

// ============================================================================
// WEBHOOK HELPERS
// ============================================================================

/** Check if comment was authored by AI (loop prevention) */
function isSelfAuthored(text: string): boolean {
  return text.trimStart().startsWith(AI_MARKER);
}

/** Check if comment matches trigger patterns */
function matchesTrigger(text: string): boolean {
  return TRIGGER_PATTERNS.some(p => p.test(text));
}

/** Check if comment_id already processed (idempotency) */
async function isDuplicate(commentId: string, supabase: ReturnType<typeof getSupabase>): Promise<boolean> {
  const { data } = await supabase
    .from('clickup_processed_comments')
    .select('id')
    .eq('comment_id', commentId)
    .maybeSingle();
  return !!data;
}

/** Mark comment as processed */
async function markProcessed(
  commentId: string, taskId: string, eventType: string,
  status: string, responseCommentId?: string, errorMessage?: string,
  supabase?: ReturnType<typeof getSupabase>
) {
  const sb = supabase || getSupabase();
  await sb.from('clickup_processed_comments').upsert({
    comment_id: commentId,
    task_id: taskId,
    event_type: eventType,
    status,
    response_comment_id: responseCommentId || null,
    error_message: errorMessage || null,
    handled_at: new Date().toISOString(),
  }, { onConflict: 'comment_id' });
}

/** Get integration config */
async function getConfig(
  supabase: ReturnType<typeof getSupabase>,
  teamId?: string,
) {
  let query = supabase
    .from('clickup_integration_state')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (teamId) query = query.eq('team_id', teamId);

  const { data } = await query.maybeSingle();

  if (data) return data;

  // Return defaults if no row exists
  return {
    team_id: teamId,
    auto_reply_enabled: true,
    reply_trigger_mode: 'mention_only',
    ai_reply_mode: 'standard',
    allow_subtask_creation: false,
    allow_task_updates: false,
    max_reply_length: 2000,
    cooldown_seconds: 30,
    webhook_status: 'not_registered',
  };
}

/** Check per-task cooldown */
async function isOnCooldown(taskId: string, cooldownSeconds: number, supabase: ReturnType<typeof getSupabase>): Promise<boolean> {
  const cutoff = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
  const { data } = await supabase
    .from('clickup_processed_comments')
    .select('id')
    .eq('task_id', taskId)
    .eq('status', 'processed')
    .gte('handled_at', cutoff)
    .limit(1);
  return (data?.length || 0) > 0;
}

/** Fetch full task context */
async function fetchTaskContext(taskId: string, tokenOverride?: string) {
  const task = await clickupFetch(`/task/${taskId}`, 'GET', undefined, tokenOverride);
  let comments: Array<{ comment_text?: string; user?: { username?: string }; date?: string }> = [];
  try {
    const commentsRes = await clickupFetch(`/task/${taskId}/comment`, 'GET', undefined, tokenOverride);
    comments = (commentsRes.comments || []).slice(-10);
  } catch { /* comments fetch optional */ }

  return {
    id: task.id,
    name: task.name,
    description: task.description || '',
    status: task.status?.status || 'unknown',
    assignees: (task.assignees || []).map((a: { username?: string }) => a.username).filter(Boolean),
    due_date: task.due_date ? new Date(Number(task.due_date)).toISOString() : null,
    tags: (task.tags || []).map((t: { name: string }) => t.name),
    url: task.url,
    recent_comments: comments.map((c) => ({
      text: c.comment_text || '',
      user: c.user?.username || 'unknown',
      date: c.date,
    })),
  };
}

/** Detect user intent from comment text */
function detectIntent(text: string): string {
  const lower = text.toLowerCase();
  if (/summar(y|ize|ise)/.test(lower)) return 'summarize';
  if (/next\s*step|what.*next|what\s*should.*happen/.test(lower)) return 'next_steps';
  if (/block(er|ing|ed)|stuck|waiting/.test(lower)) return 'blockers';
  if (/priorit(y|ize|ise)|urgent|important/.test(lower)) return 'priority';
  if (/subtask|break.*down|decompose|split/.test(lower)) return 'subtasks';
  if (/update|status.*report|draft.*update|client.*update/.test(lower)) return 'status_update';
  if (/plan|roadmap|mileston|phase/.test(lower)) return 'execution_plan';
  if (/assign|owner|who\s*should/.test(lower)) return 'assign';
  return 'general';
}

/** Build chat payload with PM context */
function buildChatPayload(taskCtx: Record<string, unknown>, commentText: string, intent: string, replyMode: string) {
  const modeInstruction = replyMode === 'brief'
    ? 'Keep your response very brief — 2-3 sentences max.'
    : replyMode === 'detailed'
    ? 'Provide a thorough, detailed response.'
    : 'Be concise but complete. Use bullet points when helpful.';

  const intentHint: Record<string, string> = {
    summarize: 'The user is asking for a summary of this task.',
    next_steps: 'The user wants to know the next steps for this task.',
    blockers: 'The user wants to identify blockers or impediments.',
    priority: 'The user wants priority guidance for this task.',
    subtasks: 'The user wants this task broken into subtasks.',
    status_update: 'The user wants a status update or progress report drafted.',
    execution_plan: 'The user wants this turned into a structured execution plan.',
    assign: 'The user wants help with task ownership or assignment.',
    general: 'Answer the user\'s question in context of this task.',
  };

  const contextBlock = `
--- CLICKUP TASK CONTEXT ---
Task: ${taskCtx.name}
Status: ${taskCtx.status}
${taskCtx.description ? `Description: ${taskCtx.description}` : ''}
${(taskCtx.assignees as string[])?.length ? `Assignees: ${(taskCtx.assignees as string[]).join(', ')}` : ''}
${taskCtx.due_date ? `Due: ${taskCtx.due_date}` : ''}
${(taskCtx.tags as string[])?.length ? `Tags: ${(taskCtx.tags as string[]).join(', ')}` : ''}
${(taskCtx.recent_comments as { text: string; user: string }[])?.length ? `Recent comments:\n${(taskCtx.recent_comments as { text: string; user: string }[]).map((c) => `  - ${c.user}: ${c.text}`).join('\n')}` : ''}
---`;

  return {
    messages: [
      { role: 'system', content: `${PM_SYSTEM_PROMPT}\n\n${modeInstruction}\n\n${intentHint[intent] || intentHint.general}\n\n${contextBlock}` },
      { role: 'user', content: commentText },
    ],
    model: 'gpt-5.4',
    stream: false,
  };
}

/** Format AI reply for ClickUp */
function formatReply(text: string, maxLength: number): string {
  let reply = text.trim();
  if (reply.length > maxLength) {
    reply = reply.substring(0, maxLength - 3) + '...';
  }
  return `${AI_MARKER} ${reply}`;
}

/** Post a comment to ClickUp task */
async function postComment(taskId: string, text: string) {
  return clickupFetch(`/task/${taskId}/comment`, 'POST', { comment_text: text });
}

/** Call the chat edge function (non-streaming) */
async function callChat(payload: Record<string, unknown>): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${anonKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Chat function failed (${res.status}): ${errText}`);
  }

  // Chat may return streaming or JSON; handle both
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    // Collect SSE stream
    const text = await res.text();
    const lines = text.split('\n');
    let result = '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) result += delta;
        } catch { /* skip non-json */ }
      }
    }
    return result || 'I was unable to generate a response.';
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content || json.response || 'I was unable to generate a response.';
}

// ============================================================================
// WEBHOOK HANDLER
// ============================================================================

async function handleWebhook(payload: Record<string, unknown>) {
  const supabase = getSupabase();

  // Extract fields from ClickUp webhook payload
  const event = payload.event as string;
  if (event !== 'taskCommentPosted') {
    return { status: 'ignored', reason: 'unsupported_event' };
  }

  const historyItems = payload.history_items as Array<Record<string, unknown>> | undefined;
  const item = historyItems?.[0] || {};
  const comment = item.comment as Record<string, unknown> | undefined;
  const commentText = (comment?.text_content as string) || (comment?.comment_text as string) || '';
  const commentId = (comment?.id as string) || `${Date.now()}`;
  const taskId = payload.task_id as string || (item.parent_id as string) || '';

  if (!taskId || !commentText) {
    return { status: 'ignored', reason: 'missing_data' };
  }

  // 1. Loop prevention: ignore AI-authored comments
  if (isSelfAuthored(commentText)) {
    return { status: 'ignored', reason: 'self_authored' };
  }

  // 2. Idempotency: check for duplicate
  if (await isDuplicate(commentId, supabase)) {
    return { status: 'ignored', reason: 'duplicate' };
  }

  // 3. Load config
  const config = await getConfig(supabase);

  // 4. Check trigger mode
  if (!config.auto_reply_enabled) {
    return { status: 'ignored', reason: 'auto_reply_disabled' };
  }

  if (config.reply_trigger_mode === 'disabled') {
    return { status: 'ignored', reason: 'replies_disabled' };
  }

  if (config.reply_trigger_mode === 'mention_only' && !matchesTrigger(commentText)) {
    return { status: 'ignored', reason: 'no_trigger_mention' };
  }

  // 5. Cooldown check
  if (await isOnCooldown(taskId, config.cooldown_seconds || 30, supabase)) {
    return { status: 'ignored', reason: 'cooldown' };
  }

  // 6. Fetch task context
  let taskCtx: Record<string, unknown>;
  try {
    taskCtx = await fetchTaskContext(taskId);
  } catch (err) {
    await markProcessed(commentId, taskId, event, 'error', undefined, `Context fetch failed: ${err}`, supabase);
    return { status: 'error', reason: 'context_fetch_failed' };
  }

  // 7. Detect intent
  const intent = detectIntent(commentText);

  // 8. Build and call chat
  const chatPayload = buildChatPayload(taskCtx, commentText, intent, config.ai_reply_mode || 'standard');
  let aiResponse: string;
  try {
    aiResponse = await callChat(chatPayload);
  } catch (err) {
    await markProcessed(commentId, taskId, event, 'error', undefined, `Chat failed: ${err}`, supabase);
    return { status: 'error', reason: 'chat_failed' };
  }

  // 9. Format and post reply
  const formattedReply = formatReply(aiResponse, config.max_reply_length || 2000);
  let responseCommentId: string | undefined;
  try {
    const posted = await postComment(taskId, formattedReply);
    responseCommentId = posted?.id;
  } catch (err) {
    await markProcessed(commentId, taskId, event, 'error', undefined, `Post failed: ${err}`, supabase);
    return { status: 'error', reason: 'post_failed' };
  }

  // 10. Handle explicit subtask/update requests if allowed
  if (intent === 'subtasks' && config.allow_subtask_creation && /create|make|add/i.test(commentText)) {
    // AI suggested subtasks — try to parse and create them
    console.log('[ClickUp] Subtask creation requested but auto-creation from AI text not implemented yet');
  }

  // 11. Mark processed
  await markProcessed(commentId, taskId, event, 'processed', responseCommentId, undefined, supabase);

  // 12. Update integration state timestamps
  await supabase
    .from('clickup_integration_state')
    .update({
      last_webhook_event_at: new Date().toISOString(),
      last_successful_ai_reply_at: new Date().toISOString(),
    })
    .eq('team_id', config.team_id);

  return { status: 'success', intent, commentId, responseCommentId };
}

// ============================================================================
// MAIN SERVER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, params } = body;
    const tokenFromParams = typeof params?.apiToken === 'string' ? params.apiToken : undefined;
    const clickupCall = (path: string, method = 'GET', payload?: unknown) =>
      clickupFetch(path, method, payload, tokenFromParams);

    // ClickUp webhooks send the payload directly (no action field)
    if (!action && body.event) {
      const result = await handleWebhook(body);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action-based routing for frontend calls
    switch (action) {
      // ============ CONNECTION ============
      case 'connect':
      case 'test_connection': {
        const token = getToken(tokenFromParams);
        const listId = typeof params?.defaultListId === 'string'
          ? params.defaultListId
          : Deno.env.get('CLICKUP_DEFAULT_LIST_ID');
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const teamId = resolved.teamId;

        // Test team access
        const teamRes = await fetch(`${CLICKUP_BASE}/team`, {
          headers: { 'Authorization': token },
        });
        const teamOk = teamRes.ok;
        const teamData = teamOk ? await teamRes.json() : null;
        if (!teamOk) await teamRes.text(); // consume body

        // Test list access if configured
        let listOk = false;
        if (listId) {
          const listRes = await fetch(`${CLICKUP_BASE}/list/${listId}`, {
            headers: { 'Authorization': token },
          });
          listOk = listRes.ok;
          await (listOk ? listRes.json() : listRes.text());
        }

        // Update last_tested_at
        const supabase = getSupabase();
        await supabase
          .from('clickup_integration_state')
          .upsert({
            team_id: teamId,
            default_list_id: listId || null,
            last_tested_at: new Date().toISOString(),
          }, { onConflict: 'team_id' })
          .select();

        return new Response(JSON.stringify({
          connected: teamOk,
          team_id: teamId,
          list_id: listId || null,
          team_accessible: teamOk,
          list_accessible: listOk,
          teams: teamData?.teams?.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })) || resolved.teams,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ TASKS ============
      case 'list_tasks': {
        const listId = await getListId(params);
        if (!listId) throw new Error('listId required');
        const rawParams = params || {};
        const queryParams = Object.entries(rawParams).reduce<Record<string, string>>((acc, [key, value]) => {
          if (value == null) return acc;
          if (['apiToken', 'teamId', 'defaultListId', 'listId'].includes(key)) return acc;
          acc[key] = String(value);
          return acc;
        }, {});
        const query = new URLSearchParams(queryParams).toString();
        const path = query ? `/list/${listId}/task?${query}` : `/list/${listId}/task`;
        const data = await clickupCall(path);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_task': {
        if (!params?.taskId) throw new Error('taskId required');
        const data = await clickupCall(`/task/${params.taskId}`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'create_task': {
        const listId = await getListId(params);
        if (!listId) throw new Error('listId required');
        const { name, description, assignees, priority, due_date, parent, ...rest } = params || {};
        const taskBody: Record<string, unknown> = { name: name || 'New Task', ...rest };
        if (description) taskBody.description = description;
        if (assignees) taskBody.assignees = assignees;
        if (priority) taskBody.priority = priority;
        if (due_date) taskBody.due_date = due_date;
        if (parent) taskBody.parent = parent;
        const data = await clickupCall(`/list/${listId}/task`, 'POST', taskBody);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_task': {
        if (!params?.taskId) throw new Error('taskId required');
        const { taskId, ...updates } = params;
        const data = await clickupCall(`/task/${taskId}`, 'PUT', updates);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'create_subtask': {
        const listId = await getListId(params);
        if (!listId) throw new Error('listId required');
        if (!params?.parent) throw new Error('parent taskId required');
        const { name, description, parent, ...rest } = params;
        const data = await clickupCall(`/list/${listId}/task`, 'POST', {
          name: name || 'Subtask',
          description,
          parent,
          ...rest,
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ COMMENTS ============
      case 'create_comment': {
        if (!params?.taskId) throw new Error('taskId required');
        const data = await clickupCall(`/task/${params.taskId}/comment`, 'POST', {
          comment_text: params.comment_text || params.text || '',
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'list_comments': {
        if (!params?.taskId) throw new Error('taskId required');
        const data = await clickupCall(`/task/${params.taskId}/comment`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ WEBHOOK ============
      case 'register_webhook': {
        const token = getToken(tokenFromParams);
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const teamId = resolved.teamId;
        const endpoint = params?.endpoint;
        if (!endpoint) throw new Error('endpoint URL required');

        const data = await clickupCall(`/team/${teamId}/webhook`, 'POST', {
          endpoint,
          events: ['taskCommentPosted'],
        });

        // Update integration state
        const supabase = getSupabase();
        await supabase
          .from('clickup_integration_state')
          .upsert({
            team_id: teamId,
            webhook_id: data.id || data.webhook?.id,
            webhook_status: 'registered',
          }, { onConflict: 'team_id' });

        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'webhook': {
        // Manual webhook trigger for testing
        const result = await handleWebhook(params || {});
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ CONFIG ============
      case 'get_config': {
        const supabase = getSupabase();
        const teamId = typeof params?.teamId === 'string' ? params.teamId : undefined;
        const config = await getConfig(supabase, teamId);
        return new Response(JSON.stringify(config), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_config': {
        const token = getToken(tokenFromParams);
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const teamId = resolved.teamId;
        const supabase = getSupabase();
        const { data } = await supabase
          .from('clickup_integration_state')
          .upsert({ team_id: teamId, ...params }, { onConflict: 'team_id' })
          .select()
          .single();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ PM ACTIONS ============
      case 'get_task_context': {
        if (!params?.taskId) throw new Error('taskId required');
        const ctx = await fetchTaskContext(params.taskId, tokenFromParams);
        return new Response(JSON.stringify(ctx), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'analyze_task':
      case 'suggest_next_steps':
      case 'suggest_priority':
      case 'detect_blockers':
      case 'generate_project_update':
      case 'create_execution_plan': {
        if (!params?.taskId) throw new Error('taskId required');
        const ctx = await fetchTaskContext(params.taskId, tokenFromParams);
        const intentMap: Record<string, string> = {
          analyze_task: 'summarize',
          suggest_next_steps: 'next_steps',
          suggest_priority: 'priority',
          detect_blockers: 'blockers',
          generate_project_update: 'status_update',
          create_execution_plan: 'execution_plan',
        };
        const prompt = params?.prompt || `Please ${action.replace(/_/g, ' ')} for this task.`;
        const chatPayload = buildChatPayload(ctx, prompt, intentMap[action], params?.replyMode || 'standard');
        const response = await callChat(chatPayload);
        return new Response(JSON.stringify({ response, task: ctx }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============ DISCOVERY ============
      case 'list_spaces': {
        const token = getToken(tokenFromParams);
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const teamId = resolved.teamId;
        const data = await clickupCall(`/team/${teamId}/space?archived=false`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'list_folders': {
        if (!params?.spaceId) throw new Error('spaceId required');
        const data = await clickupCall(`/space/${params.spaceId}/folder?archived=false`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'list_lists': {
        // Lists in a folder
        if (params?.folderId) {
          const data = await clickupCall(`/folder/${params.folderId}/list?archived=false`);
          return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        // Folderless lists in a space
        if (params?.spaceId) {
          const data = await clickupCall(`/space/${params.spaceId}/list?archived=false`);
          return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        throw new Error('folderId or spaceId required');
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (err) {
    console.error('[ClickUp]', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
