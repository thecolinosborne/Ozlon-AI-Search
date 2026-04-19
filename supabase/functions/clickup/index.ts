import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';
const AI_MARKER = '[AI]';
const DEFAULT_TRIGGER_PATTERNS = ['@ai', '@pm', '@wisdom'];

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
  const token = tokenOverride || Deno.env.get('CLICKUP_API_TOKEN') || Deno.env.get('ClickupAPIKey');
  if (!token) throw new Error('CLICKUP_API_TOKEN not configured');
  return token;
}

type ClickUpAuthContext = {
  token: string;
  userId: string | null;
  connectionId: string | null;
};

async function tryVaultRead(
  adminClient: ReturnType<typeof createClient>,
  connectionId: string,
  userId: string,
): Promise<string | null> {
  try {
    const vaultKey = Deno.env.get("VAULT_ENCRYPTION_KEY");
    if (!vaultKey) return null;
    const keyBytes = new TextEncoder().encode(vaultKey);
    if (keyBytes.length !== 32) {
      console.warn(`[clickup/vault] VAULT_ENCRYPTION_KEY wrong length: ${keyBytes.length}`);
      return null;
    }
    const hexKey = "\\x" + Array.from(keyBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await adminClient.rpc("get_user_secret", {
      _connection_id: connectionId,
      _user_id: userId,
      _secret_name: "api_key",
      _encryption_key: hexKey,
    });
    if (error) {
      console.warn("[clickup/vault] get_user_secret error:", error.message);
      return null;
    }
    const plain = typeof data === "string" ? data.trim() : null;
    if (plain && plain.length > 0) {
      adminClient
        .from("credential_audit_log")
        .insert({
          user_id: userId,
          connection_id: connectionId,
          provider: "clickup",
          action: "vault_read",
          detail: "api_key",
        })
        .then(() => {})
        .catch(() => {});
      return plain;
    }
    return null;
  } catch (e) {
    console.warn("[clickup/vault] threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function resolveStoredClickUpToken(
  adminClient: ReturnType<typeof createClient>,
  connectionId: string,
  userId: string,
  metadata?: Record<string, unknown> | null,
): Promise<string | null> {
  const vaultKey = await tryVaultRead(adminClient, connectionId, userId);
  if (vaultKey) return vaultKey;
  const legacyKey = typeof metadata?.api_key === 'string' ? metadata.api_key.trim() : '';
  return legacyKey || null;
}

/** Resolve ClickUp auth context for authenticated user actions: vault → metadata → explicit override. */
async function resolveClickUpAuth(req: Request, tokenOverride?: string): Promise<ClickUpAuthContext> {
  const trimmedOverride = tokenOverride?.trim();
  const authHeader = req.headers.get('Authorization');
  let userId: string | null = null;
  let connectionId: string | null = null;

  if (authHeader) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        userId = user.id;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const adminClient = createClient(supabaseUrl, serviceKey);
        const { data: conns } = await adminClient
          .from('integration_connections')
          .select('id, metadata, status, updated_at')
          .eq('user_id', user.id)
          .eq('provider', 'clickup')
          .order('updated_at', { ascending: false })
          .limit(5);
        const conn = (conns || []).find((c) => c.status === 'connected') || (conns || [])[0];
        connectionId = conn?.id ?? null;

        if (conn?.id) {
          const token = await resolveStoredClickUpToken(
            adminClient,
            conn.id,
            user.id,
            (conn.metadata as Record<string, unknown> | null) ?? null,
          );
          if (token) return { token, userId, connectionId };
        }
      }
    } catch { /* fall through */ }
  }

  if (trimmedOverride) return { token: trimmedOverride, userId, connectionId };

  throw new Error('ClickUp not connected. Add your API key in Integrations → ClickUp.');
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

async function getListId(
  params?: Record<string, unknown>,
  resolvedToken?: string,
  authCtx?: Pick<ClickUpAuthContext, 'userId' | 'connectionId'>,
): Promise<string> {
  // Priority: explicit param → defaultListId param → DB config → env var → auto-discover
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
      .order('updated_at', { ascending: false });
    if (authCtx?.connectionId) query = query.eq('connection_id', authCtx.connectionId);
    else if (authCtx?.userId) query = query.eq('user_id', authCtx.userId);
    if (requestedTeamId) query = query.eq('team_id', requestedTeamId);
    query = query.limit(1);
    const { data } = await query.maybeSingle();
    if (data?.default_list_id) return data.default_list_id;
  } catch { /* fall through */ }
  
  const envList = authCtx?.userId ? null : Deno.env.get('CLICKUP_DEFAULT_LIST_ID');
  if (envList) return envList;

  // Auto-discover: get first list from first space.
  // Prefer the already-resolved per-user token; fall back to env-only getToken.
  try {
    const token = resolvedToken || getToken(params?.apiToken as string | undefined);
    const { teamId } = await resolveTeamId(token, params?.teamId as string | undefined);
    const spacesRes = await fetch(`${CLICKUP_BASE}/team/${teamId}/space?archived=false`, {
      headers: { 'Authorization': token },
    });
    if (spacesRes.ok) {
      const spacesData = await spacesRes.json();
      const spaces = spacesData?.spaces || [];
      for (const space of spaces) {
        const listsRes = await fetch(`${CLICKUP_BASE}/space/${space.id}/list`, {
          headers: { 'Authorization': token },
        });
        if (listsRes.ok) {
          const listsData = await listsRes.json();
          const lists = listsData?.lists || [];
          if (lists.length > 0) {
            const supabase = getSupabase();
            await supabase.from('clickup_integration_state').upsert({
              user_id: authCtx?.userId ?? null,
              connection_id: authCtx?.connectionId ?? null,
              team_id: teamId,
              default_list_id: lists[0].id,
            }, { onConflict: authCtx?.connectionId ? 'connection_id' : 'user_id,team_id' });
            return lists[0].id;
          }
        }
      }
    }
  } catch { /* fall through */ }

  return '';
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
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

// ============================================================================
// WEBHOOK HELPERS
// ============================================================================

/** Check if comment was authored by AI (loop prevention) */
function isSelfAuthored(text: string): boolean {
  return text.trimStart().startsWith(AI_MARKER);
}

/** Check if comment matches trigger patterns */
function matchesTrigger(text: string, customTriggers?: string[]): boolean {
  const patterns = (customTriggers && customTriggers.length > 0) ? customTriggers : DEFAULT_TRIGGER_PATTERNS;
  return patterns.some(p => text.toLowerCase().includes(p.toLowerCase()));
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

  if (config.reply_trigger_mode === 'mention_only' && !matchesTrigger(commentText, (config as Record<string, unknown>).custom_triggers as string[] | undefined)) {
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

    // ClickUp webhooks send the payload directly (no action field, no JWT).
    // This is the ONE allowed env-key path — gated by absence of `action` + presence of `body.event`.
    if (!action && body.event) {
      const result = await handleWebhook(body);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // All other (authenticated) paths require per-user credentials.
    const authCtx = await resolveClickUpAuth(req, tokenFromParams);
    const resolvedToken = authCtx.token;
    const clickupCall = (path: string, method = 'GET', payload?: unknown) =>
      clickupFetch(path, method, payload, resolvedToken);

    // Action-based routing for frontend calls
    switch (action) {
      // ============ CONNECTION ============
      case 'connect':
      case 'test_connection': {
        const token = resolvedToken;
        const listId = await getListId(params, resolvedToken, authCtx).catch(() => '');
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
            user_id: authCtx.userId,
            connection_id: authCtx.connectionId,
            team_id: teamId,
            default_list_id: listId || null,
            last_tested_at: new Date().toISOString(),
          }, { onConflict: authCtx.connectionId ? 'connection_id' : 'user_id,team_id' })
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
      case 'create_task': {
        const listId = params?.listId ? String(params.listId) : await getListId(params, resolvedToken, authCtx);
        if (!listId) throw new Error('No ClickUp list configured. Ask the user to either pick a default list in Integrations → ClickUp, or call list_clickup_spaces / list_clickup_lists to choose one and pass listId explicitly.');
        const {
          name, description, priority, status, due_date, due_date_time,
          start_date, start_date_time, assignees, tags, parent,
          listId: _lid, apiToken: _at, teamId: _tid, defaultListId: _dlid, ...rest
        } = params || {};
        if (!name) throw new Error('name required');
        const payload: Record<string, unknown> = { name, ...rest };
        if (description !== undefined) payload.description = description;
        if (priority !== undefined) payload.priority = priority;
        if (status !== undefined) payload.status = status;
        if (due_date !== undefined) payload.due_date = due_date;
        if (due_date_time !== undefined) payload.due_date_time = due_date_time;
        if (start_date !== undefined) payload.start_date = start_date;
        if (start_date_time !== undefined) payload.start_date_time = start_date_time;
        if (assignees !== undefined) payload.assignees = assignees;
        if (tags !== undefined) payload.tags = tags;
        if (parent !== undefined) payload.parent = parent;
        const data = await clickupCall(`/list/${listId}/task`, 'POST', payload);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'list_tasks': {
        // If listId provided, scope to that list; otherwise search whole workspace
        const listId = params?.listId ? String(params.listId) : await getListId(params, resolvedToken, authCtx).catch(() => '');
        if (listId) {
          const qs = new URLSearchParams();
          if (params?.statuses) for (const s of (Array.isArray(params.statuses) ? params.statuses : [params.statuses])) qs.append('statuses[]', s);
          if (params?.assignees) for (const a of (Array.isArray(params.assignees) ? params.assignees : [params.assignees])) qs.append('assignees[]', a);
          if (params?.page) qs.set('page', String(params.page));
          if (params?.subtasks) qs.set('subtasks', 'true');
          if (params?.include_closed) qs.set('include_closed', 'true');
          const data = await clickupCall(`/list/${listId}/task?${qs.toString()}`);
          return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        // Fallback: team-level filtered tasks (workspace-wide)
        const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const qs = new URLSearchParams();
        qs.set('page', String(params?.page || 0));
        if (params?.statuses) for (const s of (Array.isArray(params.statuses) ? params.statuses : [params.statuses])) qs.append('statuses[]', s);
        if (params?.assignees) for (const a of (Array.isArray(params.assignees) ? params.assignees : [params.assignees])) qs.append('assignees[]', a);
        if (params?.subtasks) qs.set('subtasks', 'true');
        if (params?.include_closed) qs.set('include_closed', 'true');
        if (params?.space_ids) for (const id of (Array.isArray(params.space_ids) ? params.space_ids : [params.space_ids])) qs.append('space_ids[]', id);
        if (params?.list_ids) for (const id of (Array.isArray(params.list_ids) ? params.list_ids : [params.list_ids])) qs.append('list_ids[]', id);
        if (params?.folder_ids) for (const id of (Array.isArray(params.folder_ids) ? params.folder_ids : [params.folder_ids])) qs.append('folder_ids[]', id);
        const data = await clickupCall(`/team/${resolved.teamId}/task?${qs.toString()}`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'search_tasks': {
        // Workspace-wide task search by name/keyword
        const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const qs = new URLSearchParams();
        qs.set('page', String(params?.page || 0));
        if (params?.statuses) for (const s of (Array.isArray(params.statuses) ? params.statuses : [params.statuses])) qs.append('statuses[]', s);
        if (params?.assignees) for (const a of (Array.isArray(params.assignees) ? params.assignees : [params.assignees])) qs.append('assignees[]', a);
        if (params?.subtasks) qs.set('subtasks', 'true');
        if (params?.include_closed) qs.set('include_closed', 'true');
        if (params?.space_ids) for (const id of (Array.isArray(params.space_ids) ? params.space_ids : [params.space_ids])) qs.append('space_ids[]', id);
        if (params?.list_ids) for (const id of (Array.isArray(params.list_ids) ? params.list_ids : [params.list_ids])) qs.append('list_ids[]', id);
        if (params?.folder_ids) for (const id of (Array.isArray(params.folder_ids) ? params.folder_ids : [params.folder_ids])) qs.append('folder_ids[]', id);
        if (params?.tags) for (const t of (Array.isArray(params.tags) ? params.tags : [params.tags])) qs.append('tags[]', t);
        if (params?.due_date_gt) qs.set('due_date_gt', String(params.due_date_gt));
        if (params?.due_date_lt) qs.set('due_date_lt', String(params.due_date_lt));
        if (params?.date_created_gt) qs.set('date_created_gt', String(params.date_created_gt));
        if (params?.date_created_lt) qs.set('date_created_lt', String(params.date_created_lt));
        if (params?.order_by) qs.set('order_by', String(params.order_by));
        if (params?.reverse) qs.set('reverse', 'true');
        const data = await clickupCall(`/team/${resolved.teamId}/task?${qs.toString()}`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_task': {
        if (!params?.taskId) throw new Error('taskId required');
        const data = await clickupCall(`/task/${params.taskId}`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_task': {
        if (!params?.taskId) throw new Error('taskId required');
        const { taskId, apiToken: _uat, teamId: _utid, defaultListId: _udlid, listId: _ulid, ...updateFields } = params;
        const data = await clickupCall(`/task/${taskId}`, 'PUT', updateFields);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'create_subtask': {
        const parentTaskId = params?.parentId || params?.parent;
        if (!parentTaskId) throw new Error('parent taskId required (use parentId or parent)');
        // Auto-resolve listId from parent task if not provided
        let listId = params?.listId ? String(params.listId) : '';
        if (!listId) {
          try {
            const parentTask = await clickupCall(`/task/${parentTaskId}`);
            listId = parentTask?.list?.id || '';
          } catch { /* fall through */ }
        }
          if (!listId) listId = await getListId(params, resolvedToken, authCtx);
        if (!listId) throw new Error('Could not resolve listId for subtask — provide listId or ensure parent task is accessible');
        const { name, description, parentId: _pid, parent: _p, listId: _lid, apiToken: _at, teamId: _tid, defaultListId: _dlid, ...rest } = params;
        const data = await clickupCall(`/list/${listId}/task`, 'POST', {
          name: name || 'Subtask',
          description,
          parent: parentTaskId,
          ...rest,
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'move_task': {
        if (!params?.taskId || !params?.listId) throw new Error('taskId and listId required');
        const data = await clickupCall(`/list/${params.listId}/task/${params.taskId}`, 'POST');
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
        const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const teamId = resolved.teamId;
        const endpoint = params?.endpoint;
        if (!endpoint) throw new Error('endpoint URL required');

        let webhookId: string | undefined;
        let alreadyExists = false;

        try {
          const data = await clickupCall(`/team/${teamId}/webhook`, 'POST', {
            endpoint,
            events: ['taskCommentPosted'],
          });
          webhookId = data.id || data.webhook?.id;
        } catch (err: unknown) {
          const msg = (err instanceof Error ? err.message : String(err));
          if (msg.includes('OAUTH_171') || msg.toLowerCase().includes('already exists')) {
            alreadyExists = true;
            // Fetch existing webhooks to get the ID
            try {
              const existing = await clickupCall(`/team/${teamId}/webhook`, 'GET');
              const hooks = existing.webhooks || existing;
              if (Array.isArray(hooks) && hooks.length > 0) {
                webhookId = hooks[0].id;
              }
            } catch { /* best effort */ }
          } else {
            throw err;
          }
        }

        // Update integration state
        const supabase = getSupabase();
        await supabase
          .from('clickup_integration_state')
          .upsert({
            user_id: authCtx.userId,
            connection_id: authCtx.connectionId,
            team_id: teamId,
            webhook_id: webhookId || null,
            webhook_status: 'registered',
          }, { onConflict: authCtx.connectionId ? 'connection_id' : 'user_id,team_id' });

        return new Response(JSON.stringify({ success: true, webhook_id: webhookId, already_exists: alreadyExists }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
        let query = supabase.from('clickup_integration_state').select('*').order('updated_at', { ascending: false });
        if (authCtx.connectionId) query = query.eq('connection_id', authCtx.connectionId);
        else if (authCtx.userId) query = query.eq('user_id', authCtx.userId);
        if (teamId) query = query.eq('team_id', teamId);
        const { data } = await query.limit(1).maybeSingle();
        const config = data || await getConfig(supabase, teamId);
        return new Response(JSON.stringify(config), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_config': {
        const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const teamId = resolved.teamId;
        const supabase = getSupabase();
        // Only pass valid DB columns, strip out auth/routing params
        const validColumns = [
          'auto_reply_enabled', 'reply_trigger_mode', 'ai_reply_mode',
          'allow_subtask_creation', 'allow_task_updates', 'default_list_id',
          'webhook_id', 'webhook_status', 'max_reply_length', 'cooldown_seconds',
          'custom_triggers',
        ];
        const dbPayload: Record<string, unknown> = {
          team_id: teamId,
          user_id: authCtx.userId,
          connection_id: authCtx.connectionId,
        };
        for (const col of validColumns) {
          if (params?.[col] !== undefined) dbPayload[col] = params[col];
        }
        const { data } = await supabase
          .from('clickup_integration_state')
          .upsert(dbPayload, { onConflict: authCtx.connectionId ? 'connection_id' : 'user_id,team_id' })
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

      // ============ TASK MUTATIONS ============
      case 'delete_task': {
        if (!params?.taskId) throw new Error('taskId required');
        const data = await clickupCall(`/task/${params.taskId}`, 'DELETE');
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'set_task_status': {
        if (!params?.taskId || !params?.status) throw new Error('taskId and status required');
        const data = await clickupCall(`/task/${params.taskId}`, 'PUT', { status: params.status });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'set_due_date': {
        if (!params?.taskId) throw new Error('taskId required');
        const data = await clickupCall(`/task/${params.taskId}`, 'PUT', {
          due_date: params.due_date || null,
          due_date_time: params.due_date_time ?? true,
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'set_assignees': {
        if (!params?.taskId) throw new Error('taskId required');
        const data = await clickupCall(`/task/${params.taskId}`, 'PUT', {
          assignees: { add: params.add || [], rem: params.rem || [] },
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ TAGS ============
      case 'add_tag': {
        if (!params?.taskId || !params?.tag) throw new Error('taskId and tag required');
        const data = await clickupCall(`/task/${params.taskId}/tag/${encodeURIComponent(params.tag)}`, 'POST');
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'remove_tag': {
        if (!params?.taskId || !params?.tag) throw new Error('taskId and tag required');
        const data = await clickupCall(`/task/${params.taskId}/tag/${encodeURIComponent(params.tag)}`, 'DELETE');
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ COMMENT MUTATIONS ============
      case 'update_comment': {
        if (!params?.commentId) throw new Error('commentId required');
        const data = await clickupCall(`/comment/${params.commentId}`, 'PUT', {
          comment_text: params.comment_text || params.text || '',
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'delete_comment': {
        if (!params?.commentId) throw new Error('commentId required');
        const data = await clickupCall(`/comment/${params.commentId}`, 'DELETE');
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ CHECKLISTS ============
      case 'create_checklist': {
        if (!params?.taskId || !params?.name) throw new Error('taskId and name required');
        const data = await clickupCall(`/task/${params.taskId}/checklist`, 'POST', { name: params.name });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'create_checklist_item': {
        if (!params?.checklistId || !params?.name) throw new Error('checklistId and name required');
        const data = await clickupCall(`/checklist/${params.checklistId}/checklist_item`, 'POST', {
          name: params.name,
          assignee: params.assignee || undefined,
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_checklist_item': {
        if (!params?.checklistId || !params?.checklistItemId) throw new Error('checklistId and checklistItemId required');
        const body: Record<string, unknown> = {};
        if (params.name !== undefined) body.name = params.name;
        if (params.resolved !== undefined) body.resolved = params.resolved;
        if (params.assignee !== undefined) body.assignee = params.assignee;
        const data = await clickupCall(
          `/checklist/${params.checklistId}/checklist_item/${params.checklistItemId}`, 'PUT', body
        );
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ CUSTOM FIELDS ============
      case 'get_custom_fields': {
        const listId = params?.listId || await getListId(params, resolvedToken, authCtx);
        if (!listId) throw new Error('listId required');
        const data = await clickupCall(`/list/${listId}/field`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'set_custom_field': {
        if (!params?.taskId || !params?.fieldId) throw new Error('taskId and fieldId required');
        const data = await clickupCall(`/task/${params.taskId}/field/${params.fieldId}`, 'POST', {
          value: params.value,
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ MEMBERS ============
      case 'list_members': {
        if (!params?.taskId) throw new Error('taskId required');
        const data = await clickupCall(`/task/${params.taskId}/member`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'list_workspace_members': {
        const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        // ClickUp v2 teams endpoint includes members
        const teamRes = await fetch(`${CLICKUP_BASE}/team`, { headers: { 'Authorization': token } });
        if (!teamRes.ok) throw new Error(`Failed to fetch teams: ${teamRes.status}`);
        const teamData = await teamRes.json();
        const team = (teamData?.teams || []).find((t: { id: string }) => t.id === resolved.teamId);
        const members = (team?.members || []).map((m: { user: { id: number; username: string; email: string } }) => ({
          id: m.user.id, username: m.user.username, email: m.user.email,
        }));
        return new Response(JSON.stringify({ members }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ DEPENDENCIES ============
      case 'get_task_dependencies': {
        if (!params?.taskId) throw new Error('taskId required');
        const task = await clickupCall(`/task/${params.taskId}`);
        return new Response(JSON.stringify({
          dependencies: task.dependencies || [],
          dependents: task.dependents || [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'add_dependency': {
        if (!params?.taskId || !params?.depends_on) throw new Error('taskId and depends_on required');
        const data = await clickupCall(`/task/${params.taskId}/dependency`, 'POST', {
          depends_on: params.depends_on,
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'delete_dependency': {
        if (!params?.taskId || !params?.depends_on) throw new Error('taskId and depends_on required');
        const data = await clickupCall(`/task/${params.taskId}/dependency?depends_on=${params.depends_on}`, 'DELETE');
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ SPACE TAGS ============
      case 'list_space_tags': {
        if (!params?.spaceId) throw new Error('spaceId required');
        const data = await clickupCall(`/space/${params.spaceId}/tag`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ LIST STATUSES ============
      case 'get_list_statuses': {
        const listId = params?.listId || await getListId(params, resolvedToken, authCtx);
        if (!listId) throw new Error('listId required');
        const data = await clickupCall(`/list/${listId}`);
        return new Response(JSON.stringify({ statuses: data.statuses || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ CHECKLIST DELETIONS ============
      case 'delete_checklist': {
        if (!params?.checklistId) throw new Error('checklistId required');
        const data = await clickupCall(`/checklist/${params.checklistId}`, 'DELETE');
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'delete_checklist_item': {
        if (!params?.checklistId || !params?.checklistItemId) throw new Error('checklistId and checklistItemId required');
        const data = await clickupCall(`/checklist/${params.checklistId}/checklist_item/${params.checklistItemId}`, 'DELETE');
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ TIME TRACKING ============
      case 'get_time_entries': {
         const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const qs = new URLSearchParams();
        if (params?.start_date) qs.set('start_date', String(params.start_date));
        if (params?.end_date) qs.set('end_date', String(params.end_date));
        if (params?.assignee) qs.set('assignee', String(params.assignee));
        const data = await clickupCall(`/team/${resolved.teamId}/time_entries?${qs.toString()}`);
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'start_time_entry': {
         const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const data = await clickupCall(`/team/${resolved.teamId}/time_entries/start`, 'POST', {
          tid: params?.taskId,
          description: params?.description || '',
        });
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'stop_time_entry': {
         const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const data = await clickupCall(`/team/${resolved.teamId}/time_entries/stop`, 'POST');
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ DISCOVERY ============
      case 'list_spaces': {
        const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const teamId = resolved.teamId;
        const data = await clickupFetch(`/team/${teamId}/space?archived=false`, 'GET', undefined, token);
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

      // ============ WORKSPACE-WIDE DISCOVERY ============
      case 'list_all_lists': {
        // Returns every list across all spaces and folders in the workspace
        const token = resolvedToken;
        const resolved = await resolveTeamId(token, typeof params?.teamId === 'string' ? params.teamId : undefined);
        const teamId = resolved.teamId;
        const spacesRes = await clickupFetch(`/team/${teamId}/space?archived=false`, 'GET', undefined, token);
        const spaces = spacesRes?.spaces || [];
        const allLists: Array<{ id: string; name: string; space: string; folder: string | null }> = [];

        for (const space of spaces) {
          // Folderless lists
          try {
            const flRes = await clickupFetch(`/space/${space.id}/list?archived=false`, 'GET', undefined, token);
            for (const l of (flRes?.lists || [])) {
              allLists.push({ id: l.id, name: l.name, space: space.name, folder: null });
            }
          } catch { /* skip */ }

          // Folders and their lists
          try {
            const foldersRes = await clickupFetch(`/space/${space.id}/folder?archived=false`, 'GET', undefined, token);
            for (const folder of (foldersRes?.folders || [])) {
              for (const l of (folder.lists || [])) {
                allLists.push({ id: l.id, name: l.name, space: space.name, folder: folder.name });
              }
            }
          } catch { /* skip */ }
        }

        return new Response(JSON.stringify({ lists: allLists, count: allLists.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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
