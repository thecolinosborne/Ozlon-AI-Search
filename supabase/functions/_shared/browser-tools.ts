// Chat-facing tools for the cloud browser agent (browser-agent edge function).
// The chat starts a task, then waits up to ~100s for it. Tasks keep running in
// the background if the reply ends first, so a dropped phone connection never
// loses work — results are saved and listable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const BROWSER_TOOLS = [
  {
    type: "function",
    function: {
      name: "browser_task",
      description: "Operate a real web browser to get something done on any website: research across sites, read account pages (bank balances, bills, dashboards), fill and submit forms, send messages on web apps, book or sign up. Use when no dedicated integration tool covers it or the info needs a live site. Risky steps (send, submit, buy, book, post, delete) pause for Colin's approval automatically. Never moves money.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "Full task in plain language, including every detail needed (exact message text, names, dates, what to report back)." },
          start_url: { type: "string", description: "Website to start on, if known." },
          where: { type: "string", enum: ["auto", "cloud"], description: "auto (default) uses Colin's own Chrome when the Ozlon add-on is connected, otherwise the cloud browser." },
        },
        required: ["goal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_task_status",
      description: "Check a browser task (or list recent ones when task_id is omitted). Use when Colin asks how a browser task went.",
      parameters: { type: "object", properties: { task_id: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_task_respond",
      description: "Respond to a paused browser task: approve or deny a pending risky action, answer its question, or cancel it. Only approve when Colin explicitly says yes in this conversation.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          response: { type: "string", enum: ["approve", "deny", "answer", "cancel"] },
          answer: { type: "string", description: "Colin's answer when response is answer." },
        },
        required: ["task_id", "response"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_sign_in",
      description: "Let Colin securely sign in to a website (bank, CRM, social) so browser tasks can use it later. Opens a live browser link where Colin types his own password — Ozlon never sees it. Call with step 'start' to get the link, then 'finish' after Colin says he is signed in. Use 'list' to show saved sign-ins.",
      parameters: {
        type: "object",
        properties: {
          step: { type: "string", enum: ["start", "finish", "list"] },
          url: { type: "string", description: "Sign-in page or site, e.g. https://chase.com" },
          label: { type: "string", description: "Friendly name, e.g. Chase" },
        },
        required: ["step"],
      },
    },
  },
];

export const BROWSER_TOOL_NAMES = new Set(BROWSER_TOOLS.map((t) => t.function.name));

export const BROWSER_FRAME = `BROWSER: You can operate a real web browser with browser_task for anything on the web (research, account pages, forms, messages). Put every needed detail in the goal. If it returns needs_approval, tell Colin exactly what will be sent/submitted and ask for a yes; only call browser_task_respond approve after he says yes. If needs_login, call browser_sign_in start and give him the link to sign in himself, then finish when he confirms. Never claim a browser result you did not get. Never invent or rewrite a link — only share URLs that a browser tool returned, character for character. When the Ozlon Chrome add-on is connected, tasks run in Colin's own Chrome where he is already signed in, and he approves risky clicks in a pop-up there. Otherwise Colin watches the cloud browser live, so keep chat replies short. If a task is still running, say it keeps going in the live window and he can ask "how did that browser task go" — never promise to message him later.`;

async function callAgent(body: Record<string, unknown>, authHeader: string, userId: string) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Prefer the service key + explicit user id: avoids expired-JWT failures mid-turn.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (userId) { headers.Authorization = `Bearer ${service}`; headers["x-user-id"] = userId; }
  else headers.Authorization = authHeader;
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/browser-agent`, { method: "POST", headers, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({ success: false, error: `browser-agent ${r.status}` }));
  return d;
}

function render(t: Record<string, any>): string {
  const steps = Array.isArray(t.steps) ? t.steps : [];
  const trail = steps.slice(-8).map((s: any) => `${s.n}. ${s.summary}${s.ok === false ? ` — failed: ${s.note}` : ""}`).join("\n");
  const base = `task_id: ${t.id}\nstatus: ${t.status}\nsteps: ${t.step_count ?? steps.length}`;
  switch (t.status) {
    case "done": return `${base}\nRESULT:\n${t.result}`;
    case "needs_approval": {
      const p = t.pending_action || {};
      return `${base}\nPAUSED FOR APPROVAL: about to click "${p.label}" on ${p.host} (${p.page}).${p.typed ? ` Text entered: "${p.typed}".` : ""}\nAsk Colin to approve or deny.${t.live_url ? `\nHe can watch the browser live: ${t.live_url}` : ""}\nRecent steps:\n${trail}`;
    }
    case "needs_input": return `${base}\nQUESTION FOR COLIN: ${t.question}`;
    case "needs_login": return `${base}\nNEEDS SIGN-IN: ${t.question}`;
    case "failed": return `${base}\nFAILED: ${t.error}\nRecent steps:\n${trail}`;
    case "cancelled": return `${base}\nCancelled.`;
    default: return `${base}\nSTILL RUNNING in the background.${t.live_url ? ` Live view: ${t.live_url}` : ""}\nRecent steps:\n${trail}`;
  }
}

async function waitFor(taskId: string, userId: string, ms: number) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const end = Date.now() + ms;
  let t: any = null;
  while (Date.now() < end) {
    const { data } = await admin.from("browser_tasks").select("*").eq("id", taskId).eq("user_id", userId).single();
    t = data;
    if (t && !["queued", "running"].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return t;
}

export async function handleBrowserTool(name: string, args: Record<string, any>, userId: string, authHeader: string): Promise<{ success: boolean; result: string }> {
  if (!userId) return { success: false, result: "Browser tasks need Colin to be signed in." };
  try {
    if (name === "browser_task") {
      // Prefer Colin's own Chrome (Ozlon add-on) when it is online: he is already signed in there.
      const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: dev } = await adm.from("browser_devices").select("id").eq("user_id", userId).eq("revoked", false)
        .gt("last_seen_at", new Date(Date.now() - 75_000).toISOString()).limit(1).maybeSingle();
      if (dev && args.where !== "cloud") {
        const { data: lt, error: le } = await adm.from("browser_tasks").insert({ user_id: userId, goal: String(args.goal).slice(0, 4000), start_url: args.start_url || null, executor: "local", status: "queued", phase: "thinking" }).select("id").single();
        if (le) return { success: false, result: `Could not start: ${le.message}` };
        const t = await waitFor(lt.id, userId, 100_000);
        return { success: true, result: `Running in Colin's own Chrome via the Ozlon add-on (he approves risky clicks in a pop-up there).\n` + render(t) };
      }
      const d = await callAgent({ action: "start", goal: args.goal, start_url: args.start_url }, authHeader, userId);
      if (!d.success) return { success: false, result: `Could not start the browser: ${d.error}` };
      const t = await waitFor(d.task_id, userId, 100_000);
      let extra = "";
      if (t?.status === "needs_login" && t.pending_action?.domain) {
        // Open the secure sign-in browser right away so the link is real, never invented.
        const l = await callAgent({ action: "login_start", url: t.pending_action.domain }, authHeader, userId);
        if (l.success && l.live_url) extra = `\nSECURE SIGN-IN LINK (give Colin exactly this URL, unchanged): ${l.live_url}\nHe signs in himself there. When he says he is done, call browser_sign_in finish with url ${l.domain}; the task then resumes on its own.`;
      }
      return { success: true, result: (d.using_login ? `Using saved sign-in: ${d.using_login}\n` : "") + render(t) + extra };
    }
    if (name === "browser_task_status") {
      const d = await callAgent({ action: "status", task_id: args.task_id }, authHeader, userId);
      if (!d.success) return { success: false, result: d.error };
      if (d.task) return { success: true, result: render(d.task) };
      return { success: true, result: (d.tasks || []).map((t: any) => `- ${t.goal.slice(0, 90)} — ${t.status} (task_id ${t.id})`).join("\n") || "No browser tasks yet." };
    }
    if (name === "browser_task_respond") {
      const r = String(args.response);
      // Task ids are not visible in prior chat text, so resolve to the most recent
      // paused task when the id is missing or does not belong to this user.
      {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const wanted = r === "answer" ? ["needs_input"] : r === "cancel" ? ["queued", "running", "needs_approval", "needs_input", "needs_login"] : ["needs_approval"];
        let ok = false;
        if (/^[0-9a-f-]{36}$/i.test(String(args.task_id || ""))) {
          const { data } = await admin.from("browser_tasks").select("id,status").eq("id", args.task_id).eq("user_id", userId).maybeSingle();
          ok = !!data && wanted.includes(data.status);
        }
        if (!ok) {
          const { data } = await admin.from("browser_tasks").select("id").eq("user_id", userId).in("status", wanted).order("updated_at", { ascending: false }).limit(1).maybeSingle();
          if (!data) return { success: false, result: "There is no browser task waiting on you right now." };
          args.task_id = data.id;
        }
      }
      if (r === "answer") {
        const admL = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: lt } = await admL.from("browser_tasks").select("executor").eq("id", args.task_id).maybeSingle();
        if (lt?.executor === "local") {
          await admL.from("browser_tasks").update({ status: "running", pending_action: { answer: String(args.answer || "") }, question: null, phase: "working" }).eq("id", args.task_id).eq("user_id", userId);
          return { success: true, result: render(await waitFor(String(args.task_id), userId, 90_000)) };
        }
      }
      const action = r === "cancel" ? "cancel" : r === "answer" ? "answer" : "approve";
      const d = await callAgent({ action, task_id: args.task_id, decision: r === "deny" ? "deny" : "approve", answer: args.answer }, authHeader, userId);
      if (!d.success) return { success: false, result: d.error };
      if (d.status === "running") return { success: true, result: render(await waitFor(String(args.task_id), userId, 90_000)) };
      return { success: true, result: `Task ${d.status}.` };
    }
    if (name === "browser_sign_in") {
      const step = String(args.step);
      if (step === "list") {
        const d = await callAgent({ action: "logins_list" }, authHeader, userId);
        return { success: true, result: (d.logins || []).map((l: any) => `- ${l.label} (${l.domain}) — ${l.status}`).join("\n") || "No saved sign-ins yet." };
      }
      if (step === "start") {
        const d = await callAgent({ action: "login_start", url: args.url, label: args.label }, authHeader, userId);
        if (!d.success) return { success: false, result: d.error };
        return { success: true, result: `Sign-in browser is open for ${d.domain}. Give Colin this link to sign in himself (it expires in 30 minutes): ${d.live_url}\nWhen he says he is signed in, call browser_sign_in finish with url ${d.domain}.` };
      }
      const d = await callAgent({ action: "login_finish", domain: args.url }, authHeader, userId);
      if (!d.success) return { success: false, result: d.error };
      return { success: true, result: `Saved sign-in for ${d.domain}.${d.resumed_tasks?.length ? ` Resumed ${d.resumed_tasks.length} waiting task(s).` : ""}` };
    }
    return { success: false, result: `Unknown browser tool ${name}` };
  } catch (e) {
    return { success: false, result: `Browser error: ${(e as Error).message}` };
  }
}
