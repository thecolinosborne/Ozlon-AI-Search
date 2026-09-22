// ============================================================================
// OUTCOME ENGINE — the executive-assistant layer.
//
// Turns any goal-shaped ask, in any industry and for any of the user's
// businesses — starting, fixing, or growing one — into an
// Outcome Spec: goal → what success looks like → done-when → ordered steps →
// first move with an owner and a date. Then delivers it into ClickUp as one
// human-readable parent task with subtasks, and keeps pushing it forward.
//
// Owns:
//   1. OUTCOME_TOOLS        — tool definitions exposed to the chat model
//   2. handleOutcomeTool    — execution (service-role client)
//   3. buildOutcomeContext  — compact businesses/outcomes pack for the prompt
//   4. OUTCOME_FRAME        — the doctrine appended to the system prompt
//
// Everything is user-scoped. Nothing here mutates existing tables.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export interface OutcomeToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OutcomeToolResult {
  success: boolean;
  result: string;
}

export function outcomeAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

function epochMs(date?: string | null): number | undefined {
  if (!date) return undefined;
  const t = Date.parse(`${date}T17:00:00Z`);
  return isNaN(t) ? undefined : t;
}

// ============================================================================
// 1. TOOL DEFINITIONS
// ============================================================================

const stepSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "The piece of work, stated as a result. 'Cleaner contract signed by a lawyer', not 'look at contracts'." },
    detail: { type: "string", description: "One or two plain sentences: what doing this actually involves." },
    owner: { type: "string", description: "Who does it. 'Colin', a worker's name, or 'Ozlon' when the assistant can do it." },
    due_date: { type: "string", description: "YYYY-MM-DD." },
  },
  required: ["title"],
};

export const OUTCOME_TOOLS: OutcomeToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_ventures",
      description:
        "List the user's businesses (ventures) with their stage, what already exists, who works there, and their ClickUp list. Call this BEFORE creating any task or outcome so work lands in the right business and you don't re-plan things already built.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_venture",
      description:
        "Create or update a business the user operates. Use when the user names a new business, or tells you something durable about one (its stage, what's already built, who works in it, which ClickUp list its work belongs in). Only pass fields the user actually gave you.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Business name, any industry." },
          description: { type: "string" },
          stage: { type: "string", enum: ["idea", "building", "launching", "operating", "scaling", "paused"] },
          what_exists: { type: "string", description: "What is already built or in place today." },
          who_works_here: { type: "string", description: "People and roles." },
          clickup_list_id: { type: "string", description: "ClickUp list this business's work goes into." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_outcome",
      description:
        "Save an Outcome Spec: the goal, what success looks like, how we know it's done, and the ordered steps from here to there. Call this INSTEAD of create_clickup_task whenever the user asks for something goal-shaped ('I want to start X', 'we need to hire cleaners', 'get the site live'). Write every field in plain human language — no jargon, no machine text. Then show the user the rendered outcome and ask whether to send it to ClickUp.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short name for the outcome." },
          venture_name: { type: "string", description: "Which business this belongs to. Match an existing one where possible." },
          goal: { type: "string", description: "One sentence: what the user is actually trying to get to." },
          current_state: { type: "string", description: "Where things stand today — point A. Use what you already know before asking." },
          success_looks_like: { type: "array", items: { type: "string" }, description: "Point B, in things you can point at. e.g. 'A live booking site that takes payment', 'Two cleaners working a weekly route'." },
          done_when: { type: "array", items: { type: "string" }, description: "The checks that close this out. Concrete and verifiable." },
          steps: { type: "array", items: stepSchema, description: "Ordered steps from A to B. Each one a real piece of work with an owner and a date where you can infer them." },
          first_move: { type: "string", description: "The single next action, starting with a verb." },
          owner: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD for the whole outcome." },
        },
        required: ["title", "goal", "success_looks_like", "steps"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_outcomes",
      description: "List the user's saved outcomes with their business, status, and step progress. Use before planning new work, when the user asks what's in flight, or to find an outcome id.",
      parameters: {
        type: "object",
        properties: {
          venture_name: { type: "string" },
          status: { type: "string", enum: ["draft", "delivered", "active", "done", "dropped"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deliver_outcome",
      description:
        "Send a saved outcome into ClickUp: one parent task with a readable description (Goal, Success looks like, Done when, Steps) plus a subtask per step with its own due date. Call this only after the user agrees to send it. Never hand-build this with create_clickup_task.",
      parameters: {
        type: "object",
        properties: {
          outcome_id: { type: "string" },
          title_match: { type: "string", description: "Keyword to find the outcome when no id is known." },
          list_id: { type: "string", description: "Optional ClickUp list. Defaults to the business's list, then the configured default list." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_outcome_step",
      description: "Mark a step done, blocked, or re-dated, or change its owner. Use whenever the user reports movement ('the site's live', 'contract's signed', 'that's stuck on the lawyer').",
      parameters: {
        type: "object",
        properties: {
          step_id: { type: "string" },
          outcome_title_match: { type: "string", description: "Outcome keyword when matching the step by name." },
          step_title_match: { type: "string", description: "Step keyword when no step_id is known." },
          status: { type: "string", enum: ["open", "in_progress", "blocked", "done"] },
          owner: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD." },
          note: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "brief_worker",
      description:
        "Leave a written brief as a comment on a ClickUp task so whoever owns it — a worker, or another assistant watching that board — has the full context without the user retyping it. Write it for a human: what to do, why it matters, what done looks like, and by when.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "ClickUp task id. Omit when using outcome_id to brief the outcome's parent task." },
          outcome_id: { type: "string" },
          brief: { type: "string", description: "The instructions, in plain language." },
          assignee_ids: { type: "array", items: { type: "number" }, description: "Optional ClickUp member ids to assign." },
        },
        required: ["brief"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "outcome_pulse",
      description:
        "Read every active outcome, its step progress, what's overdue and what hasn't moved, and get a per-business read of the single next move. Call this for 'what should I be doing', 'where are we at', weekly reviews, and before suggesting new work.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export const OUTCOME_TOOL_NAMES = new Set(OUTCOME_TOOLS.map((t) => t.function.name));

// ============================================================================
// 2. DOCTRINE
// ============================================================================

export const OUTCOME_FRAME = `
## OUTCOME DOCTRINE (how work gets created)

You are Colin's executive assistant across every business he runs. Any industry, any number of businesses, at any stage — starting one, fixing one, or growing one. You are never specialised to a single trade, and you never assume the business in front of you is the only one. You do not write tasks that restate the request. You define the result.

Two kinds of ask get the same treatment: starting something new, and growing or fixing something that already runs (more leads, better retention, higher price, less of Colin's time). Growth asks are outcomes too — never answer them with loose advice.

When the ask is goal-shaped — start it, launch it, fix it, grow it, hire for it, systemise it — you do this before anything is created:

1. NAME THE BUSINESS. Call list_ventures. Decide which of Colin's businesses this belongs to. Never mix one business's work into another. If it's a new business, upsert_venture first, whatever the industry.
2. FIX POINT A. Say where that business already stands, from what you know — what's built, who's in place, what's running. Do not re-plan work that already exists.
3. FIX POINT B. What success looks like in things he can point at: a live page taking payment, a named person running a route each week, a pipeline that books work without him touching it, a number moving from X to Y. Never vague adjectives.
4. LIST THE STEPS A TO B. Ordered, each a real piece of work stated as a result, each with an owner and a date where you can infer one. Include the automations and workflows written out so a human can follow them.
5. NAME THE FIRST MOVE. One action, one owner, one date.

Then call save_outcome, show it back in plain language, and ask if you should send it to ClickUp. On yes, call deliver_outcome — never hand-build it with create_clickup_task.

Hard rules:
- Never call create_clickup_task for a goal-shaped ask. That tool is for a single small errand only.
- Ask at most ONE clarifying question, and only when the answer would change the steps. Otherwise assume, state the assumption in one line, and move.
- Descriptions are for humans. No raw data, no JSON, no field names in the output.
- Never name a tool, an id, or a field in what the user reads. Say "I saved the plan", not "I ran save_outcome". No ids unless the user asked for one.
- Report progress with outcome_pulse rather than guessing. When something is overdue or hasn't moved, say so and name the unblocking action.
- When work belongs to someone else, brief_worker so they have the context.
- Be the one pushing. Every reply about a business ends with the next move and who owns it.

NEVER REPORT WORK YOU DID NOT DO. This is absolute:
- Do not say anything was sent to ClickUp unless deliver_outcome returned a task id to you in THIS turn.
- Do not state step counts, progress, overdue items, or business names unless outcome_pulse or list_outcomes returned them in THIS turn.
- Never invent a business, an outcome, or a number. If you do not have the tool result, call the tool. If the tool fails, say plainly what failed and what you need.
- When the user says "yes, send it", your first action is a tool call, not a summary.
`.trim();

// ============================================================================
// 3. CONTEXT PACK
// ============================================================================

export async function buildOutcomeContext(admin: SupabaseClient, userId: string): Promise<string> {
  try {
    const [{ data: ventures }, { data: outcomes }] = await Promise.all([
      admin.from("ventures").select("id,name,stage,what_exists,who_works_here").eq("user_id", userId).eq("is_active", true).limit(8),
      admin.from("outcome_specs").select("id,title,venture_id,status,due_date").eq("user_id", userId).in("status", ["draft", "delivered", "active"]).order("updated_at", { ascending: false }).limit(12),
    ]);
    if (!ventures?.length && !outcomes?.length) return "";
    const byId = new Map((ventures || []).map((v) => [v.id as string, v.name as string]));
    const lines: string[] = ["## BUSINESSES & OUTCOMES"];
    for (const v of ventures || []) {
      lines.push(`- ${v.name} (${v.stage})${v.what_exists ? ` — in place: ${String(v.what_exists).slice(0, 180)}` : ""}${v.who_works_here ? ` — people: ${String(v.who_works_here).slice(0, 120)}` : ""}`);
    }
    if (outcomes?.length) {
      lines.push("Active outcomes:");
      for (const o of outcomes) {
        lines.push(`- [${o.id}] ${o.title}${o.venture_id ? ` · ${byId.get(o.venture_id as string) || "unassigned"}` : ""} · ${o.status}${o.due_date ? ` · due ${o.due_date}` : ""}`);
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

// ============================================================================
// 4. RENDERING
// ============================================================================

interface StepRow {
  id?: string;
  title: string;
  detail?: string | null;
  owner?: string | null;
  due_date?: string | null;
  status?: string;
  clickup_task_id?: string | null;
}

interface OutcomeRow {
  id: string;
  title: string;
  goal: string;
  current_state?: string | null;
  success_looks_like: string[];
  done_when: string[];
  first_move?: string | null;
  owner?: string | null;
  due_date?: string | null;
}

/** Human-readable ClickUp description. Never JSON, never field names. */
export function renderOutcomeDescription(o: OutcomeRow, steps: StepRow[], ventureName?: string): string {
  const L: string[] = [];
  L.push(o.goal);
  L.push("");
  if (ventureName) L.push(`Business: ${ventureName}`);
  if (o.current_state) {
    L.push("");
    L.push("Where we are now");
    L.push(o.current_state);
  }
  if (o.success_looks_like?.length) {
    L.push("");
    L.push("Success looks like");
    for (const s of o.success_looks_like) L.push(`- ${s}`);
  }
  if (o.done_when?.length) {
    L.push("");
    L.push("Done when");
    for (const s of o.done_when) L.push(`- ${s}`);
  }
  if (steps.length) {
    L.push("");
    L.push("Steps");
    steps.forEach((s, i) => {
      const meta = [s.owner ? `owner: ${s.owner}` : "", s.due_date ? `by ${s.due_date}` : ""].filter(Boolean).join(" · ");
      L.push(`${i + 1}. ${s.title}${meta ? ` (${meta})` : ""}`);
      if (s.detail) L.push(`   ${s.detail}`);
    });
  }
  if (o.first_move) {
    L.push("");
    L.push(`First move: ${o.first_move}${o.owner ? ` — ${o.owner}` : ""}${o.due_date ? ` by ${o.due_date}` : ""}`);
  }
  return L.join("\n");
}

// ============================================================================
// 5. CLICKUP BRIDGE
// ============================================================================

async function callClickUp(
  action: string,
  params: Record<string, unknown>,
  authHeader?: string,
): Promise<Record<string, unknown>> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/clickup`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify({ action, params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { error?: string }).error) {
    throw new Error(String((data as { error?: string }).error || `ClickUp ${action} failed (${res.status})`));
  }
  return data as Record<string, unknown>;
}

// ============================================================================
// 6. EXECUTION
// ============================================================================

async function findVenture(admin: SupabaseClient, userId: string, name?: string) {
  const n = str(name);
  if (!n) return null;
  const { data } = await admin
    .from("ventures").select("*").eq("user_id", userId)
    .ilike("name", `%${n.replace(/[%_]/g, "")}%`).limit(1);
  return data?.[0] || null;
}

async function findOutcome(admin: SupabaseClient, userId: string, id?: string, titleMatch?: string) {
  if (str(id)) {
    const { data } = await admin.from("outcome_specs").select("*").eq("user_id", userId).eq("id", str(id)).maybeSingle();
    if (data) return data;
  }
  if (str(titleMatch)) {
    const { data } = await admin
      .from("outcome_specs").select("*").eq("user_id", userId)
      .ilike("title", `%${str(titleMatch).replace(/[%_]/g, "")}%`)
      .order("updated_at", { ascending: false }).limit(1);
    if (data?.length) return data[0];
  }
  return null;
}

export async function handleOutcomeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
  authHeader?: string,
  admin: SupabaseClient = outcomeAdminClient(),
): Promise<OutcomeToolResult> {
  if (!userId) return { success: false, result: "Not signed in — businesses and outcomes are per-user." };

  try {
    switch (name) {
      case "list_ventures": {
        const { data } = await admin.from("ventures").select("*").eq("user_id", userId).order("created_at");
        if (!data?.length) {
          return { success: true, result: "No businesses recorded yet. Ask which businesses he runs, then call upsert_venture for each." };
        }
        return {
          success: true,
          result: data.map((v) =>
            `- [${v.id}] ${v.name} · ${v.stage}${v.clickup_list_id ? ` · ClickUp list ${v.clickup_list_id}` : ""}\n` +
            `  in place: ${v.what_exists || "unknown"}\n  people: ${v.who_works_here || "unknown"}`
          ).join("\n"),
        };
      }

      case "upsert_venture": {
        const vname = str(args.name);
        if (!vname) return { success: false, result: "name is required" };
        const existing = await findVenture(admin, userId, vname);
        const patch: Record<string, unknown> = { user_id: userId, name: vname };
        for (const k of ["description", "stage", "what_exists", "who_works_here", "clickup_list_id"]) {
          if (str(args[k])) patch[k] = str(args[k]);
        }
        if (existing) {
          const { error } = await admin.from("ventures").update(patch).eq("id", existing.id).eq("user_id", userId);
          if (error) return { success: false, result: `Could not update business: ${error.message}` };
          return { success: true, result: `Updated ${vname}.` };
        }
        const { data, error } = await admin.from("ventures").insert(patch).select("id").maybeSingle();
        if (error) return { success: false, result: `Could not create business: ${error.message}` };
        return { success: true, result: `Created ${vname} (id ${data?.id}).` };
      }

      case "save_outcome": {
        const title = str(args.title);
        const goal = str(args.goal);
        const steps = Array.isArray(args.steps) ? (args.steps as Record<string, unknown>[]) : [];
        if (!title || !goal) return { success: false, result: "title and goal are required" };
        if (!steps.length) return { success: false, result: "steps are required — an outcome without a path from A to B is just a wish." };

        const venture = await findVenture(admin, userId, str(args.venture_name));
        const { data: spec, error } = await admin.from("outcome_specs").insert({
          user_id: userId,
          venture_id: venture?.id ?? null,
          title,
          goal,
          current_state: str(args.current_state) || null,
          success_looks_like: strArr(args.success_looks_like),
          done_when: strArr(args.done_when),
          first_move: str(args.first_move) || null,
          owner: str(args.owner) || null,
          due_date: str(args.due_date) || null,
          status: "draft",
        }).select("*").maybeSingle();
        if (error || !spec) return { success: false, result: `Could not save outcome: ${error?.message}` };

        const rows = steps.map((s, i) => ({
          user_id: userId,
          outcome_id: spec.id,
          position: i,
          title: str(s.title) || `Step ${i + 1}`,
          detail: str(s.detail) || null,
          owner: str(s.owner) || null,
          due_date: str(s.due_date) || null,
        }));
        const { error: stepErr } = await admin.from("outcome_steps").insert(rows);
        if (stepErr) return { success: false, result: `Outcome saved but steps failed: ${stepErr.message}` };

        const preview = renderOutcomeDescription(spec as unknown as OutcomeRow, rows as StepRow[], venture?.name);
        return {
          success: true,
          result: `Outcome saved (id ${spec.id})${venture ? ` under ${venture.name}` : " with no business attached"}.\n\n${preview}\n\nAsk whether to send it to ClickUp, then call deliver_outcome.`,
        };
      }

      case "list_outcomes": {
        let q = admin.from("outcome_specs").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(25);
        if (str(args.status)) q = q.eq("status", str(args.status));
        const venture = await findVenture(admin, userId, str(args.venture_name));
        if (venture) q = q.eq("venture_id", venture.id);
        const { data } = await q;
        if (!data?.length) return { success: true, result: "No outcomes saved yet." };
        const ids = data.map((o) => o.id);
        const { data: steps } = await admin.from("outcome_steps").select("outcome_id,status").in("outcome_id", ids);
        const tally = new Map<string, { done: number; total: number }>();
        for (const s of steps || []) {
          const t = tally.get(s.outcome_id as string) || { done: 0, total: 0 };
          t.total += 1;
          if (s.status === "done") t.done += 1;
          tally.set(s.outcome_id as string, t);
        }
        return {
          success: true,
          result: data.map((o) => {
            const t = tally.get(o.id) || { done: 0, total: 0 };
            return `- [${o.id}] ${o.title} · ${o.status} · ${t.done}/${t.total} steps done${o.due_date ? ` · due ${o.due_date}` : ""}${o.clickup_task_id ? ` · ClickUp ${o.clickup_task_id}` : ""}`;
          }).join("\n"),
        };
      }

      case "deliver_outcome": {
        const spec = await findOutcome(admin, userId, str(args.outcome_id), str(args.title_match));
        if (!spec) return { success: false, result: "No matching outcome. Call list_outcomes first." };
        if (spec.clickup_task_id) {
          return { success: false, result: `This outcome is already in ClickUp as task ${spec.clickup_task_id}. Update that task instead of creating a duplicate.` };
        }
        const { data: steps } = await admin.from("outcome_steps").select("*").eq("outcome_id", spec.id).order("position");
        const venture = spec.venture_id
          ? (await admin.from("ventures").select("*").eq("id", spec.venture_id).maybeSingle()).data
          : null;

        const listId = str(args.list_id) || str(venture?.clickup_list_id) || undefined;
        const description = renderOutcomeDescription(spec as unknown as OutcomeRow, (steps || []) as StepRow[], venture?.name);

        const parent = await callClickUp("create_task", {
          ...(listId ? { listId } : {}),
          name: spec.title,
          description,
          ...(epochMs(spec.due_date) ? { due_date: epochMs(spec.due_date) } : {}),
        }, authHeader);
        const parentId = String((parent as { id?: string }).id || "");
        if (!parentId) return { success: false, result: "ClickUp created nothing back — no task id returned." };

        const created: string[] = [];
        const failed: string[] = [];
        for (const s of steps || []) {
          try {
            const stepDue = epochMs(s.due_date as string | null);
            const sub = await callClickUp("create_subtask", {
              parentId,
              name: s.title,
              ...(s.detail || s.owner
                ? {
                  description: [s.detail || "", s.owner ? `Owner: ${s.owner}` : ""]
                    .filter(Boolean).join("\n"),
                }
                : {}),
              ...(stepDue ? { due_date: stepDue } : {}),
            }, authHeader);
            const subId = String((sub as { id?: string }).id || "");
            if (subId) {
              created.push(s.title as string);
              await admin.from("outcome_steps").update({ clickup_task_id: subId }).eq("id", s.id).eq("user_id", userId);
            }
          } catch (e) {
            failed.push(`${s.title} (${e instanceof Error ? e.message : String(e)})`);
          }
        }

        await admin.from("outcome_specs").update({
          clickup_task_id: parentId,
          clickup_list_id: listId ?? null,
          status: "delivered",
        }).eq("id", spec.id).eq("user_id", userId);

        const url = String((parent as { url?: string }).url || "");
        return {
          success: failed.length === 0,
          result: `Sent "${spec.title}" to ClickUp as task ${parentId}${url ? ` (${url})` : ""} with ${created.length} step${created.length === 1 ? "" : "s"} as subtasks.` +
            (failed.length ? `\nThese steps did not go over: ${failed.join("; ")}` : ""),
        };
      }

      case "update_outcome_step": {
        let step: Record<string, unknown> | null = null;
        if (str(args.step_id)) {
          const { data } = await admin.from("outcome_steps").select("*").eq("user_id", userId).eq("id", str(args.step_id)).maybeSingle();
          step = data;
        }
        if (!step && str(args.step_title_match)) {
          let q = admin.from("outcome_steps").select("*, outcome_specs!inner(title)").eq("user_id", userId)
            .ilike("title", `%${str(args.step_title_match).replace(/[%_]/g, "")}%`);
          if (str(args.outcome_title_match)) {
            const o = await findOutcome(admin, userId, undefined, str(args.outcome_title_match));
            if (o) q = q.eq("outcome_id", o.id);
          }
          const { data } = await q.limit(1);
          step = data?.[0] ?? null;
        }
        if (!step) return { success: false, result: "No matching step. Call list_outcomes, then outcome_pulse, to see the steps." };

        const patch: Record<string, unknown> = {};
        if (str(args.status)) patch.status = str(args.status);
        if (str(args.owner)) patch.owner = str(args.owner);
        if (str(args.due_date)) patch.due_date = str(args.due_date);
        if (str(args.note)) patch.detail = `${step.detail ? `${step.detail}\n` : ""}${new Date().toISOString().slice(0, 10)}: ${str(args.note)}`;
        if (!Object.keys(patch).length) return { success: false, result: "Nothing to update." };

        const { error } = await admin.from("outcome_steps").update(patch).eq("id", step.id as string).eq("user_id", userId);
        if (error) return { success: false, result: `Update failed: ${error.message}` };

        // Mirror into ClickUp where the subtask exists.
        if (step.clickup_task_id) {
          if (patch.status === "done") {
            await callClickUp("update_task", { taskId: step.clickup_task_id, status: "complete" }, authHeader).catch(() => {});
          }
          if (patch.due_date) {
            const due = epochMs(String(patch.due_date));
            if (due) await callClickUp("update_task", { taskId: step.clickup_task_id, due_date: due }, authHeader).catch(() => {});
          }
        }

        // Close the outcome when every step is done.
        const { data: siblings } = await admin.from("outcome_steps").select("status").eq("outcome_id", step.outcome_id as string);
        const allDone = (siblings || []).length > 0 && (siblings || []).every((s) => s.status === "done");
        if (allDone) {
          await admin.from("outcome_specs").update({ status: "done" }).eq("id", step.outcome_id as string).eq("user_id", userId);
        }
        return { success: true, result: `Updated "${step.title}"${patch.status ? ` → ${patch.status}` : ""}.${allDone ? " That was the last step — the outcome is closed." : ""}` };
      }

      case "brief_worker": {
        const brief = str(args.brief);
        if (!brief) return { success: false, result: "brief is required" };
        let taskId = str(args.task_id);
        if (!taskId && str(args.outcome_id)) {
          const spec = await findOutcome(admin, userId, str(args.outcome_id));
          taskId = str(spec?.clickup_task_id);
        }
        if (!taskId) return { success: false, result: "No task to brief. Pass task_id, or deliver the outcome to ClickUp first." };

        await callClickUp("create_comment", { taskId, comment_text: brief }, authHeader);
        const assignees = Array.isArray(args.assignee_ids) ? (args.assignee_ids as number[]) : [];
        if (assignees.length) {
          await callClickUp("update_task", { taskId, assignees: { add: assignees } }, authHeader).catch(() => {});
        }
        return { success: true, result: `Brief left on task ${taskId}${assignees.length ? ` and assigned to ${assignees.length} member(s)` : ""}.` };
      }

      case "outcome_pulse": {
        return { success: true, result: await buildPulse(admin, userId) };
      }

      default:
        return { success: false, result: `Unknown outcome tool: ${name}` };
    }
  } catch (e) {
    return { success: false, result: `Outcome tool ${name} failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ============================================================================
// 7. PULSE — what moved, what didn't, what's next
// ============================================================================

export async function buildPulse(admin: SupabaseClient, userId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const staleBefore = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: ventures }, { data: outcomes }] = await Promise.all([
    admin.from("ventures").select("id,name,stage").eq("user_id", userId).eq("is_active", true),
    admin.from("outcome_specs").select("*").eq("user_id", userId).in("status", ["draft", "delivered", "active"]).order("updated_at", { ascending: false }).limit(25),
  ]);
  if (!outcomes?.length) return "No active outcomes. Nothing is being pushed forward right now.";

  const { data: steps } = await admin.from("outcome_steps").select("*").in("outcome_id", outcomes.map((o) => o.id)).order("position");
  const vName = new Map((ventures || []).map((v) => [v.id as string, v.name as string]));
  const byOutcome = new Map<string, Record<string, unknown>[]>();
  for (const s of steps || []) {
    const arr = byOutcome.get(s.outcome_id as string) || [];
    arr.push(s);
    byOutcome.set(s.outcome_id as string, arr);
  }

  const lines: string[] = [];
  for (const o of outcomes) {
    const ss = byOutcome.get(o.id) || [];
    const done = ss.filter((s) => s.status === "done").length;
    const overdue = ss.filter((s) => s.status !== "done" && s.due_date && String(s.due_date) < today);
    const next = ss.find((s) => s.status !== "done");
    const stale = String(o.updated_at) < staleBefore;
    lines.push(
      `- ${o.title} · ${o.venture_id ? vName.get(o.venture_id as string) || "unassigned" : "unassigned"} · ${done}/${ss.length} steps done` +
      (overdue.length ? ` · ${overdue.length} overdue` : "") +
      (stale ? " · no movement in 7 days" : "") +
      (next ? `\n  next: ${next.title}${next.owner ? ` — ${next.owner}` : ""}${next.due_date ? ` by ${next.due_date}` : ""}` : "\n  next: nothing left open — close it out") +
      (o.status === "draft" ? "\n  not in ClickUp yet — offer to send it" : ""),
    );
  }
  return `Pulse for ${today}\n${lines.join("\n")}`;
}

// ============================================================================
// 5. GOAL-SHAPED ASK DETECTION (mechanical trigger)
// ============================================================================
// The doctrine alone is not enough: when a request also names a tool stack
// (GoHighLevel, ClickUp, a website), the model drifts into integration
// discovery and answers in prose. This makes the trigger deterministic.

const GOAL_PATTERNS: RegExp[] = [
  /\bi\s+(want|wanna|need|would like)\s+to\s+(start|launch|build|set\s*up|create|open|scale|grow)\b/i,
  /\bsuccess\s+(looks?|would\s+look)\s+like\b/i,
  /\blet'?s\s+(start|launch|build|set\s*up)\s+(a|an|the|my)\b/i,
  /\b(start|launch|spin\s*up)\s+(a|an|my|the)\s+[a-z\s]{2,40}\b(company|business|brand|agency|service)\b/i,
  /\bget\s+(the|my|our)\s+[a-z\s]{2,30}\b(live|launched|off the ground|running)\b/i,
  /\bwe\s+need\s+to\s+(build|launch|hire|set\s*up|stand\s*up)\b/i,
  /\bfrom\s+(scratch|zero)\b.*\b(business|company|brand)\b/i,
];

export function isGoalShapedAsk(text: string): boolean {
  const t = String(text || "").slice(0, 2000);
  if (t.length < 20) return false;
  return GOAL_PATTERNS.some((re) => re.test(t));
}

export const OUTCOME_ENFORCEMENT = `
## THIS TURN IS A GOAL-SHAPED ASK — OUTCOME REQUIRED

The user has described something they want to exist, not a small errand. The outcome doctrine is not optional here.

Your FIRST tool call this turn is list_ventures. Nothing else comes first — not GoHighLevel, not ClickUp, not a search.

Then, in this order:
1. upsert_venture if this business is not already on the list.
2. save_outcome with the full picture: where things stand now, what success looks like in things the user can point at, and the ordered steps from here to there. Each step is a result with an owner and a date where you can infer one. Cover every part of what they said success means — if they named branding, a site, automations, capture, CRM and tracking, every one of those is a step or a success criterion. Do not stop at five steps if the goal needs more.
3. Show it back in plain language and ask whether to send it to their project management. Do not send it unasked.

Never ask permission to plan. Creating the venture and then offering to "capture the outcome" is a failure — save_outcome happens in THIS turn, without asking. The only question you may ask at the end is whether to send the finished plan to their project management.

Reading their tool accounts (GoHighLevel pipelines, forms, workflows) is allowed only to fix where things stand — never as a substitute for the plan. Answering this turn in prose with no saved outcome is a failure.
`.trim();
