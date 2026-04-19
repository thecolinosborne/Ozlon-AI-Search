// Execute a work_task: fires the chat AI with full tools enabled,
// streams progress into ai_activity_log, and writes the final result
// into draft_output / final_deliverable.
//
// Invoked from the Tasks UI ("Run with AI" button) and on auto-creation
// when assigned_to === 'ai'.

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

async function appendActivity(
  taskId: string,
  currentLog: ActivityEntry[],
  entry: ActivityEntry,
  patch: Record<string, unknown> = {},
) {
  const next = [...(currentLog || []), entry];
  await admin
    .from("work_tasks")
    .update({
      ai_activity_log: next,
      last_activity_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", taskId);
  return next;
}

async function executeTask(taskId: string) {
  const { data: task, error: tErr } = await admin
    .from("work_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (tErr || !task) {
    return { success: false, error: "Task not found" };
  }

  let log: ActivityEntry[] = Array.isArray(task.ai_activity_log)
    ? (task.ai_activity_log as ActivityEntry[])
    : [];

  // Mark as executing
  log = await appendActivity(
    taskId,
    log,
    {
      timestamp: new Date().toISOString(),
      action: "execution_started",
      detail: "AI picked up the task and started working.",
      actor: "ai",
      status: "executing",
    },
    {
      status: "in_progress",
      ai_status: "executing",
      next_action: "waiting_on_ai",
    },
  );

  try {
    // Build the prompt the AI will work on
    const userPrompt = [
      task.title,
      task.description ? `\n\nDetails:\n${task.description}` : "",
      task.revision_notes ? `\n\nNotes:\n${task.revision_notes}` : "",
    ].join("");

    const systemContext =
      `You are executing a personal task for the user. Task type: ${task.task_type}. ` +
      `Intent: ${task.intent_type}. Use any tools you need to complete it. ` +
      `Be concise but thorough. Return a clean, well-formatted deliverable the user can read at a glance. ` +
      `If you cannot complete it because of missing info or a missing connection, say exactly what's needed.`;

    const chatRes = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: userPrompt }],
        userId: task.user_id,
        enableTools: true,
        systemContext,
      }),
    });

    const chatJson = await chatRes.json().catch(() => ({}));
    const output: string =
      chatJson?.message ||
      chatJson?.content ||
      chatJson?.choices?.[0]?.message?.content ||
      "(no output)";

    if (!chatRes.ok) {
      log = await appendActivity(
        taskId,
        log,
        {
          timestamp: new Date().toISOString(),
          action: "execution_failed",
          detail: `Chat returned ${chatRes.status}: ${String(output).slice(0, 300)}`,
          actor: "ai",
          status: "failed",
        },
        {
          ai_status: "error",
          next_action: "waiting_on_human",
        },
      );
      return { success: false, error: `Chat ${chatRes.status}` };
    }

    // Success — store output and move to review
    log = await appendActivity(
      taskId,
      log,
      {
        timestamp: new Date().toISOString(),
        action: "execution_completed",
        detail: "AI finished. Output ready for your review.",
        actor: "ai",
        status: "completed",
      },
      {
        status: "up_for_review",
        ai_status: "waiting",
        next_action: "needs_review",
        draft_output: output,
      },
    );

    return { success: true, output };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendActivity(
      taskId,
      log,
      {
        timestamp: new Date().toISOString(),
        action: "execution_error",
        detail: msg.slice(0, 500),
        actor: "system",
        status: "failed",
      },
      {
        ai_status: "error",
        next_action: "waiting_on_human",
      },
    );
    return { success: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const taskId = body.task_id ?? body.taskId;
    if (!taskId) {
      return new Response(JSON.stringify({ error: "task_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await executeTask(taskId);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
