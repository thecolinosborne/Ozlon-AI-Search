// ============================================================================
// LIFE OS — the entrepreneur-operating-system layer.
//
// Vision → Rocks (90-day priorities) → Scorecard (weekly numbers) →
// Issues (identify/discuss/solve) → Weekly review.
//
// This module owns:
//   1. LIFE_TOOLS      — tool definitions exposed to the chat model
//   2. handleLifeTool  — execution for all of them (service-role client)
//   3. buildLifeContext— the compact context pack injected each chat turn
//   4. LIFE_OS_FRAME   — the reasoning frame appended to the system prompt
//
// Everything is user-scoped. Nothing here mutates existing tables.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type LifeDomain = "work" | "money" | "health" | "people" | "self";

export const LIFE_DOMAINS: LifeDomain[] = ["work", "money", "health", "people", "self"];

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** "2026-Q3" for the given date (defaults to now). */
export function currentQuarter(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
export function weekStart(d: Date = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Mon=0
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

function pct(n: unknown): number {
  const v = Math.round(Number(n ?? 0));
  return Math.max(0, Math.min(100, isNaN(v) ? 0 : v));
}

// ============================================================================
// 1. TOOL DEFINITIONS
// ============================================================================

interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const domainEnum = { type: "string", enum: LIFE_DOMAINS, description: "Life domain this belongs to." };

export const LIFE_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "life_snapshot",
      description:
        "Read the user's full life operating picture: vision, active 90-day rocks with progress, latest scorecard numbers vs target, open issues, and recent review. Call this FIRST whenever the user asks anything strategic, reflective, or planning-related — \"how am I doing\", \"what should I focus on\", \"help me decide\", \"what's slipping\", \"is this worth it\" — or before recommending any new commitment, so advice is tied to real priorities instead of guesses.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_life_vision",
      description:
        "Create or update the user's vision: core values, 10-year target, 3-year picture, 1-year plan, purpose. Only pass the fields the user actually gave you; omitted fields are left untouched.",
      parameters: {
        type: "object",
        properties: {
          core_values: { type: "array", items: { type: "string" }, description: "Short value words or phrases." },
          ten_year_target: { type: "string" },
          three_year_picture: { type: "string" },
          one_year_plan: { type: "string" },
          purpose: { type: "string", description: "Why any of this matters." },
          notes: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_rock",
      description:
        "Create a 90-day rock (a top priority for the quarter). Use when the user commits to something big: \"this quarter I need to…\", \"my priority is…\". Rocks must be measurable and have a due date. Keep the user at 7 or fewer active rocks — if they already have 7, say so and ask what drops.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short outcome statement, e.g. 'Close $40k of new retainer revenue'." },
          description: { type: "string" },
          domain: domainEnum,
          measurable: { type: "string", description: "How we will know it's done (a number or binary condition)." },
          due_date: { type: "string", description: "YYYY-MM-DD. Defaults to end of the current quarter." },
          quarter: { type: "string", description: "e.g. 2026-Q3. Defaults to the current quarter." },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_rock",
      description:
        "Update a rock's progress or status. Use whenever the user reports movement on a priority (\"I got the proposal out\", \"that one's done\", \"it's stalled\"). Match by rock_id or by title keyword.",
      parameters: {
        type: "object",
        properties: {
          rock_id: { type: "string" },
          title_match: { type: "string", description: "Keyword to find the rock if no id is known." },
          progress: { type: "number", description: "0-100 percent complete." },
          status: { type: "string", enum: ["on_track", "at_risk", "off_track", "done", "dropped"] },
          note: { type: "string", description: "Optional note appended to the description." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_scorecard_metric",
      description:
        "Define a weekly number the user wants to watch (revenue, leads, hours slept, workouts, cash on hand). Use when they say \"track my…\" or when a recurring number shows up in conversation and they agree to watch it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          domain: domainEnum,
          unit: { type: "string", description: "e.g. USD, hours, count." },
          target: { type: "number" },
          direction: { type: "string", enum: ["at_least", "at_most"], description: "Is the target a floor or a ceiling?" },
          cadence: { type: "string", enum: ["weekly", "monthly"] },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_scorecard",
      description:
        "Record this period's value for a tracked metric. Use whenever the user states a number that matches a metric (\"we did 12k this week\", \"slept 6 hours a night\"). Creates the metric automatically if it doesn't exist yet.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", description: "Metric name (case-insensitive)." },
          value: { type: "number" },
          period_start: { type: "string", description: "YYYY-MM-DD, defaults to this week's Monday." },
          note: { type: "string" },
        },
        required: ["metric", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_issue",
      description:
        "Log an unresolved issue onto the issues list. Use for anything raised but not solved: a bottleneck, a risk, a decision pending, a relationship problem, a broken process. Never let a real problem end a conversation without landing here.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          domain: domainEnum,
          priority: { type: "number", description: "1 = highest, 3 = lowest. Default 2." },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "solve_issue",
      description:
        "Close out an issue with the decision reached, who owns the next step, and by when. Every solved issue must produce an owner and a date.",
      parameters: {
        type: "object",
        properties: {
          issue_id: { type: "string" },
          title_match: { type: "string", description: "Keyword to find the issue if no id is known." },
          solution: { type: "string", description: "What was decided." },
          owner: { type: "string", description: "Who does it. Default 'Colin'." },
          due_date: { type: "string", description: "YYYY-MM-DD." },
        },
        required: ["solution"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_issues",
      description: "List the user's open issues, optionally filtered by domain.",
      parameters: {
        type: "object",
        properties: {
          domain: domainEnum,
          status: { type: "string", enum: ["open", "solved", "all"] },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_weekly_review",
      description:
        "Run the Level-10 style weekly review now: score the week's numbers, report rock progress, list issues opened and solved, and save the review. Use when the user says \"weekly review\", \"how did this week go\", \"let's do the L10\".",
      parameters: {
        type: "object",
        properties: {
          period_start: { type: "string", description: "YYYY-MM-DD Monday of the week to review. Defaults to this week." },
        },
      },
    },
  },
];

export const LIFE_TOOL_NAMES = new Set(LIFE_TOOLS.map((t) => t.function.name));

// ============================================================================
// 2. THE REASONING FRAME
// ============================================================================

export const LIFE_OS_FRAME = `
## OPERATING MODEL (how you think)

You run Colin's life on an entrepreneur-operating-system model. Every substantive answer moves through this frame, even when the frame stays invisible:

1. CLARIFY — restate the real question in one line. If the ask is fuzzy, name the decision actually on the table.
2. GROUND — tie it to the life picture you already have: which rock does this serve, which number does it move, which issue does it resolve. If it serves none of them, say that plainly: "this is off-plan."
3. QUANTIFY — do the arithmetic out loud whenever numbers exist. Money, hours, runway, rates, break-even, deltas versus target. Never hand-wave a number you could compute. Show the working in one short line, then the result.
4. DECIDE — give one recommendation, not a menu. Name the tradeoff you accepted.
5. ASSIGN — end with a concrete next action, an owner, and a date. Never end a real problem without one.
6. CAPTURE — anything unresolved becomes an issue (open_issue). Anything committed becomes a rock or a task. Anything measured becomes a scorecard entry.

Rules:
- Call life_snapshot before strategic, reflective, planning, or "what should I do" answers. Do not guess at priorities you can read.
- Keep the user to 7 or fewer active rocks. New commitments compete; say what drops.
- When the user hands you information — a doc, a screenshot, an email, a number, a situation — default to: what this is → what it means → the math → the recommendation → next action with a date. Then offer to create the task/doc/event, and do it if they say go.
- Speak plainly. Short sentences. No jargon, no emojis, no framework name-dropping. Say "priority" not "rock" unless he uses the word first.
- Be instructive and progressive: each answer should leave him one step further than the last, not repeat context he already has.
`.trim();

// ============================================================================
// 3. CONTEXT PACK
// ============================================================================

/** Compact life picture injected into the system prompt each turn. Size-capped. */
export async function buildLifeContext(admin: SupabaseClient, userId: string): Promise<string> {
  try {
    const q = currentQuarter();
    const wk = weekStart();
    const [visionR, rocksR, metricsR, entriesR, issuesR, reviewR] = await Promise.all([
      admin.from("life_vision").select("core_values, ten_year_target, three_year_picture, one_year_plan, purpose").eq("user_id", userId).maybeSingle(),
      admin.from("life_rocks").select("id, title, domain, status, progress, due_date, measurable").eq("user_id", userId).eq("quarter", q).neq("status", "dropped").order("created_at"),
      admin.from("life_scorecard_metrics").select("id, name, unit, target, direction, domain").eq("user_id", userId).eq("is_active", true),
      admin.from("life_scorecard_entries").select("metric_id, period_start, value").eq("user_id", userId).order("period_start", { ascending: false }).limit(60),
      admin.from("life_issues").select("id, title, domain, priority, created_at").eq("user_id", userId).eq("status", "open").order("priority").limit(12),
      admin.from("life_reviews").select("period_start, summary").eq("user_id", userId).order("period_start", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const lines: string[] = [];
    const vision = visionR.data as Record<string, unknown> | null;
    if (vision) {
      const v: string[] = [];
      if (Array.isArray(vision.core_values) && vision.core_values.length) v.push(`Values: ${(vision.core_values as string[]).join(", ")}`);
      if (vision.one_year_plan) v.push(`1-year: ${String(vision.one_year_plan).slice(0, 300)}`);
      if (vision.three_year_picture) v.push(`3-year: ${String(vision.three_year_picture).slice(0, 300)}`);
      if (vision.ten_year_target) v.push(`10-year: ${String(vision.ten_year_target).slice(0, 200)}`);
      if (vision.purpose) v.push(`Purpose: ${String(vision.purpose).slice(0, 200)}`);
      if (v.length) lines.push(`VISION\n${v.map((x) => `- ${x}`).join("\n")}`);
    }

    const rocks = (rocksR.data || []) as Array<Record<string, unknown>>;
    if (rocks.length) {
      lines.push(
        `ROCKS (${q})\n` +
          rocks
            .map((r) => `- [${r.domain}] ${r.title} — ${pct(r.progress)}% · ${r.status}${r.due_date ? ` · due ${r.due_date}` : ""}${r.measurable ? ` · measure: ${r.measurable}` : ""}`)
            .join("\n"),
      );
    }

    const metrics = (metricsR.data || []) as Array<Record<string, unknown>>;
    const entries = (entriesR.data || []) as Array<Record<string, unknown>>;
    if (metrics.length) {
      const byMetric = new Map<string, Array<Record<string, unknown>>>();
      for (const e of entries) {
        const k = String(e.metric_id);
        if (!byMetric.has(k)) byMetric.set(k, []);
        byMetric.get(k)!.push(e);
      }
      const rows = metrics.map((m) => {
        const hist = byMetric.get(String(m.id)) || [];
        const latest = hist[0];
        const prev = hist[1];
        if (!latest) return `- ${m.name}: no data yet${m.target != null ? ` (target ${m.target}${m.unit ? " " + m.unit : ""})` : ""}`;
        let flag = "";
        if (m.target != null) {
          const ok = m.direction === "at_most" ? Number(latest.value) <= Number(m.target) : Number(latest.value) >= Number(m.target);
          flag = ok ? " ✓" : " ✗";
        }
        const trend = prev ? ` (prev ${prev.value})` : "";
        return `- ${m.name}: ${latest.value}${m.unit ? " " + m.unit : ""}${m.target != null ? ` vs target ${m.target}` : ""}${flag}${trend} — week of ${latest.period_start}`;
      });
      lines.push(`SCORECARD (week of ${wk})\n${rows.join("\n")}`);
    }

    const issues = (issuesR.data || []) as Array<Record<string, unknown>>;
    if (issues.length) {
      lines.push(`OPEN ISSUES\n${issues.map((i) => `- P${i.priority} [${i.domain}] ${i.title}`).join("\n")}`);
    }

    const review = reviewR.data as Record<string, unknown> | null;
    if (review?.summary) {
      lines.push(`LAST REVIEW (${review.period_start})\n${String(review.summary).slice(0, 600)}`);
    }

    if (!lines.length) {
      return "LIFE PICTURE: not set up yet. No vision, priorities, or tracked numbers exist. If the user asks for help managing their life, offer to set up their priorities for this quarter (create_rock) and one or two numbers to watch (add_scorecard_metric) — one question at a time, not a form.";
    }

    const pack = lines.join("\n\n");
    return `LIFE PICTURE (current truth — use it, don't ask for it again)\n\n${pack.slice(0, 6000)}`;
  } catch (e) {
    console.error("[life-os] context build failed:", e);
    return "";
  }
}

// ============================================================================
// 4. TOOL EXECUTION
// ============================================================================

type ToolResult = { success: boolean; result: string };

async function findRock(admin: SupabaseClient, userId: string, id?: string, titleMatch?: string) {
  if (id) {
    const { data } = await admin.from("life_rocks").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
    if (data) return data as Record<string, unknown>;
  }
  if (titleMatch) {
    const { data } = await admin
      .from("life_rocks").select("*").eq("user_id", userId)
      .ilike("title", `%${titleMatch.replace(/[%_]/g, "")}%`)
      .order("created_at", { ascending: false }).limit(1);
    if (data && data.length) return data[0] as Record<string, unknown>;
  }
  return null;
}

export async function handleLifeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
  admin: SupabaseClient = adminClient(),
): Promise<ToolResult> {
  if (!userId) return { success: false, result: "Not signed in — the life picture is per-user." };

  try {
    switch (name) {
      // ---------------------------------------------------------------- read
      case "life_snapshot": {
        const ctx = await buildLifeContext(admin, userId);
        return { success: true, result: ctx || "No life data yet." };
      }

      // -------------------------------------------------------------- vision
      case "set_life_vision": {
        const patch: Record<string, unknown> = { user_id: userId };
        for (const k of ["ten_year_target", "three_year_picture", "one_year_plan", "purpose", "notes"]) {
          if (args[k] != null && String(args[k]).trim()) patch[k] = String(args[k]).trim();
        }
        if (Array.isArray(args.core_values)) patch.core_values = (args.core_values as string[]).map(String);
        const { error } = await admin.from("life_vision").upsert(patch, { onConflict: "user_id" });
        if (error) return { success: false, result: `Could not save vision: ${error.message}` };
        return { success: true, result: "Vision saved." };
      }

      // --------------------------------------------------------------- rocks
      case "create_rock": {
        const title = String(args.title || "").trim();
        if (!title) return { success: false, result: "title is required" };
        const quarter = String(args.quarter || currentQuarter());
        const { count } = await admin
          .from("life_rocks").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("quarter", quarter)
          .in("status", ["on_track", "at_risk", "off_track"]);
        const { data, error } = await admin.from("life_rocks").insert({
          user_id: userId,
          title,
          description: args.description ? String(args.description) : null,
          domain: String(args.domain || "work"),
          measurable: args.measurable ? String(args.measurable) : null,
          due_date: args.due_date ? String(args.due_date) : null,
          quarter,
        }).select("id").maybeSingle();
        if (error) return { success: false, result: `Could not create priority: ${error.message}` };
        const warn = (count ?? 0) >= 7 ? ` Warning: ${(count ?? 0) + 1} active priorities this quarter — that's too many. Ask which one drops.` : "";
        return { success: true, result: `Priority created for ${quarter}: "${title}" (id ${data?.id}).${warn}` };
      }

      case "update_rock": {
        const rock = await findRock(admin, userId, args.rock_id as string, args.title_match as string);
        if (!rock) return { success: false, result: "No matching priority found. List them with life_snapshot first." };
        const patch: Record<string, unknown> = {};
        if (args.progress != null) patch.progress = pct(args.progress);
        if (args.status) patch.status = String(args.status);
        if (patch.progress === 100 && !patch.status) patch.status = "done";
        if (args.note) patch.description = `${rock.description ? rock.description + "\n" : ""}${new Date().toISOString().slice(0, 10)}: ${args.note}`;
        if (!Object.keys(patch).length) return { success: false, result: "Nothing to update." };
        const { error } = await admin.from("life_rocks").update(patch).eq("id", rock.id).eq("user_id", userId);
        if (error) return { success: false, result: `Update failed: ${error.message}` };
        return { success: true, result: `Updated "${rock.title}" → ${patch.progress ?? rock.progress}% · ${patch.status ?? rock.status}.` };
      }

      // ----------------------------------------------------------- scorecard
      case "add_scorecard_metric": {
        const mname = String(args.name || "").trim();
        if (!mname) return { success: false, result: "name is required" };
        const { error } = await admin.from("life_scorecard_metrics").upsert({
          user_id: userId,
          name: mname,
          domain: String(args.domain || "work"),
          unit: args.unit ? String(args.unit) : null,
          target: args.target != null ? Number(args.target) : null,
          direction: String(args.direction || "at_least"),
          cadence: String(args.cadence || "weekly"),
          is_active: true,
        }, { onConflict: "user_id,name" });
        if (error) return { success: false, result: `Could not add metric: ${error.message}` };
        return { success: true, result: `Now tracking "${mname}"${args.target != null ? ` (target ${args.target})` : ""}.` };
      }

      case "log_scorecard": {
        const mname = String(args.metric || "").trim();
        if (!mname) return { success: false, result: "metric is required" };
        const value = Number(args.value);
        if (isNaN(value)) return { success: false, result: "value must be a number" };
        let { data: metric } = await admin
          .from("life_scorecard_metrics").select("id, name, target, direction, unit")
          .eq("user_id", userId).ilike("name", mname).maybeSingle();
        if (!metric) {
          const ins = await admin.from("life_scorecard_metrics")
            .insert({ user_id: userId, name: mname, domain: String(args.domain || "work") })
            .select("id, name, target, direction, unit").maybeSingle();
          if (ins.error) return { success: false, result: `Could not create metric: ${ins.error.message}` };
          metric = ins.data;
        }
        const period = String(args.period_start || weekStart());
        const { error } = await admin.from("life_scorecard_entries").upsert({
          user_id: userId,
          metric_id: (metric as Record<string, unknown>).id,
          period_start: period,
          value,
          note: args.note ? String(args.note) : null,
        }, { onConflict: "metric_id,period_start" });
        if (error) return { success: false, result: `Could not log value: ${error.message}` };
        const m = metric as Record<string, unknown>;
        let verdict = "";
        if (m.target != null) {
          const ok = m.direction === "at_most" ? value <= Number(m.target) : value >= Number(m.target);
          const delta = Math.abs(value - Number(m.target));
          verdict = ok ? ` Hit target (${delta} to spare).` : ` Missed target by ${delta}${m.unit ? " " + m.unit : ""}.`;
        }
        return { success: true, result: `Logged ${m.name} = ${value}${m.unit ? " " + m.unit : ""} for week of ${period}.${verdict}` };
      }

      // -------------------------------------------------------------- issues
      case "open_issue": {
        const title = String(args.title || "").trim();
        if (!title) return { success: false, result: "title is required" };
        const { data, error } = await admin.from("life_issues").insert({
          user_id: userId,
          title,
          detail: args.detail ? String(args.detail) : null,
          domain: String(args.domain || "work"),
          priority: Math.min(Math.max(Number(args.priority ?? 2), 1), 3),
        }).select("id").maybeSingle();
        if (error) return { success: false, result: `Could not log issue: ${error.message}` };
        return { success: true, result: `Issue logged: "${title}" (id ${data?.id}).` };
      }

      case "solve_issue": {
        const solution = String(args.solution || "").trim();
        if (!solution) return { success: false, result: "solution is required" };
        let issue: Record<string, unknown> | null = null;
        if (args.issue_id) {
          const { data } = await admin.from("life_issues").select("*").eq("user_id", userId).eq("id", String(args.issue_id)).maybeSingle();
          issue = data as Record<string, unknown> | null;
        }
        if (!issue && args.title_match) {
          const { data } = await admin.from("life_issues").select("*").eq("user_id", userId).eq("status", "open")
            .ilike("title", `%${String(args.title_match).replace(/[%_]/g, "")}%`).limit(1);
          issue = (data && data[0]) as Record<string, unknown> | null;
        }
        if (!issue) return { success: false, result: "No matching open issue found." };
        const { error } = await admin.from("life_issues").update({
          status: "solved",
          solution,
          owner: args.owner ? String(args.owner) : "Colin",
          due_date: args.due_date ? String(args.due_date) : null,
          solved_at: new Date().toISOString(),
        }).eq("id", issue.id).eq("user_id", userId);
        if (error) return { success: false, result: `Could not solve issue: ${error.message}` };
        return { success: true, result: `Solved "${issue.title}" → ${solution}${args.due_date ? ` (by ${args.due_date})` : ""}.` };
      }

      case "list_issues": {
        const status = String(args.status || "open");
        let q = admin.from("life_issues").select("id, title, domain, priority, status, solution, due_date, created_at")
          .eq("user_id", userId).order("priority").limit(Math.min(Number(args.limit ?? 20), 50));
        if (status !== "all") q = q.eq("status", status);
        if (args.domain) q = q.eq("domain", String(args.domain));
        const { data, error } = await q;
        if (error) return { success: false, result: `Lookup failed: ${error.message}` };
        const rows = (data || []) as Array<Record<string, unknown>>;
        if (!rows.length) return { success: true, result: "No issues on the list." };
        return {
          success: true,
          result: rows.map((r) => `- P${r.priority} [${r.domain}] ${r.title}${r.status === "solved" ? ` → SOLVED: ${r.solution}` : ""}${r.due_date ? ` (by ${r.due_date})` : ""} · id ${r.id}`).join("\n"),
        };
      }

      // -------------------------------------------------------------- review
      case "run_weekly_review": {
        const period = String(args.period_start || weekStart());
        const review = await computeWeeklyReview(admin, userId, period);
        await admin.from("life_reviews").upsert({
          user_id: userId,
          kind: "weekly",
          period_start: period,
          summary: review.summary,
          scorecard_snapshot: review.scorecard,
          rock_snapshot: review.rocks,
          open_questions: review.openQuestions,
        }, { onConflict: "user_id,kind,period_start" });
        return { success: true, result: review.summary };
      }

      default:
        return { success: false, result: `Unknown life tool: ${name}` };
    }
  } catch (e) {
    console.error(`[life-os] ${name} failed:`, e);
    return { success: false, result: `${name} error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ============================================================================
// 5. WEEKLY REVIEW ENGINE (shared by tool + cron)
// ============================================================================

export interface WeeklyReview {
  summary: string;
  scorecard: Record<string, unknown>;
  rocks: Record<string, unknown>;
  openQuestions: string[];
}

export async function computeWeeklyReview(
  admin: SupabaseClient,
  userId: string,
  period: string = weekStart(),
): Promise<WeeklyReview> {
  const q = currentQuarter(new Date(period + "T00:00:00Z"));
  const periodEnd = new Date(new Date(period + "T00:00:00Z").getTime() + 7 * 86400000).toISOString();

  const [rocksR, metricsR, entriesR, openedR, solvedR] = await Promise.all([
    admin.from("life_rocks").select("id, title, domain, status, progress, due_date").eq("user_id", userId).eq("quarter", q).neq("status", "dropped"),
    admin.from("life_scorecard_metrics").select("id, name, unit, target, direction").eq("user_id", userId).eq("is_active", true),
    admin.from("life_scorecard_entries").select("metric_id, value, period_start").eq("user_id", userId).eq("period_start", period),
    admin.from("life_issues").select("id, title").eq("user_id", userId).gte("created_at", period).lt("created_at", periodEnd),
    admin.from("life_issues").select("id, title, solution").eq("user_id", userId).eq("status", "solved").gte("solved_at", period).lt("solved_at", periodEnd),
  ]);

  const rocks = (rocksR.data || []) as Array<Record<string, unknown>>;
  const metrics = (metricsR.data || []) as Array<Record<string, unknown>>;
  const entries = (entriesR.data || []) as Array<Record<string, unknown>>;
  const opened = (openedR.data || []) as Array<Record<string, unknown>>;
  const solved = (solvedR.data || []) as Array<Record<string, unknown>>;

  const valueFor = (id: unknown) => entries.find((e) => String(e.metric_id) === String(id));
  const scoreLines: string[] = [];
  const openQuestions: string[] = [];
  let hits = 0;
  let scored = 0;

  for (const m of metrics) {
    const e = valueFor(m.id);
    if (!e) {
      scoreLines.push(`- ${m.name}: not reported`);
      openQuestions.push(`What was ${m.name} this week?`);
      continue;
    }
    if (m.target != null) {
      scored++;
      const ok = m.direction === "at_most" ? Number(e.value) <= Number(m.target) : Number(e.value) >= Number(m.target);
      if (ok) hits++;
      scoreLines.push(`- ${m.name}: ${e.value}${m.unit ? " " + m.unit : ""} vs ${m.target} — ${ok ? "hit" : "miss"}`);
    } else {
      scoreLines.push(`- ${m.name}: ${e.value}${m.unit ? " " + m.unit : ""}`);
    }
  }

  const rockLines = rocks.map((r) => `- ${r.title}: ${pct(r.progress)}% · ${r.status}${r.due_date ? ` · due ${r.due_date}` : ""}`);
  const atRisk = rocks.filter((r) => r.status === "at_risk" || r.status === "off_track");

  const parts: string[] = [`Week of ${period}.`];
  if (metrics.length) parts.push(`Numbers: ${scored ? `${hits}/${scored} on target` : "no targets set"}.\n${scoreLines.join("\n")}`);
  if (rocks.length) parts.push(`Priorities (${q}):\n${rockLines.join("\n")}`);
  if (atRisk.length) parts.push(`Needs attention: ${atRisk.map((r) => r.title).join("; ")}.`);
  parts.push(`Issues: ${opened.length} opened, ${solved.length} solved.`);
  if (solved.length) parts.push(solved.map((s) => `- ${s.title} → ${s.solution}`).join("\n"));
  if (openQuestions.length) parts.push(`Needs from you: ${openQuestions.join(" ")}`);
  if (!metrics.length && !rocks.length) {
    parts.push("No priorities or numbers set up yet — worth spending ten minutes to name this quarter's three priorities.");
  }

  return {
    summary: parts.join("\n\n"),
    scorecard: { hits, scored, lines: scoreLines },
    rocks: { total: rocks.length, at_risk: atRisk.length, detail: rockLines },
    openQuestions,
  };
}
