import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Globe, Check, X, Square, ExternalLink, KeyRound, Trash2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Task = {
  id: string; goal: string; status: string; result: string | null; question: string | null; error: string | null;
  pending_action: { label?: string; host?: string; typed?: string; page?: string } | null;
  step_count: number; live_url: string | null; created_at: string;
};
type Login = { id: string; label: string; domain: string; status: string };

const STATUS: Record<string, string> = {
  queued: "Starting", running: "Working", paused: "Paused", done: "Done", failed: "Didn't finish", cancelled: "Stopped",
  needs_approval: "Waiting for your OK", needs_input: "Has a question", needs_login: "Needs you to sign in",
};

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("browser-agent", { body });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error);
  return data;
}

export default function Browser() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logins, setLogins] = useState<Login[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [site, setSite] = useState("");
  const [pending, setPending] = useState<{ domain: string; url: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, l] = await Promise.all([call({ action: "status", limit: 20 }), call({ action: "logins_list" })]);
      setTasks(t.tasks || []); setLogins(l.logins || []);
    } catch (e) { console.warn(e); }
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase.channel("browser_tasks_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "browser_tasks" }, () => void load())
      .subscribe();
    const iv = setInterval(load, 8000);
    return () => { supabase.removeChannel(ch); clearInterval(iv); };
  }, [load]);

  const act = async (id: string, body: Record<string, unknown>, ok: string) => {
    setBusy(id);
    try { await call(body); toast.success(ok); await load(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const startLogin = async () => {
    if (!site.trim()) return;
    setBusy("login");
    try {
      const d = await call({ action: "login_start", url: site.trim() });
      setPending({ domain: d.domain, url: d.live_url });
      window.open(d.live_url, "_blank", "noopener");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const finishLogin = async () => {
    if (!pending) return;
    await act("login", { action: "login_finish", domain: pending.domain }, `Saved your sign-in for ${pending.domain}`);
    setPending(null); setSite("");
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/80 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Link to="/settings" aria-label="Back" className="rounded-full p-2 hover:bg-muted"><ArrowLeft className="h-5 w-5" /></Link>
          <Globe className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Browser</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-4 pt-6">
        <p className="text-sm text-muted-foreground">
          Ask the assistant to do things on any website. It stops and asks before it sends, submits, buys or deletes anything. It never moves money and never types your passwords.
        </p>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recent tasks</h2>
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Try asking: "Use the browser to find…"</p>}
          {tasks.map((t) => (
            <div key={t.id} className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium leading-snug">{t.goal}</p>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{STATUS[t.status] || t.status}</span>
              </div>
              {(t.status === "running" || t.status === "queued") && (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{t.step_count} steps so far</p>
              )}
              {t.status === "done" && t.result && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{t.result}</p>}
              {t.status === "failed" && t.error && <p className="mt-2 text-sm text-destructive">{t.error}</p>}
              {(t.status === "needs_input" || t.status === "needs_login") && t.question && <p className="mt-2 text-sm">{t.question}</p>}
              {t.status === "needs_approval" && t.pending_action && (
                <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
                  About to press <strong>"{t.pending_action.label}"</strong> on {t.pending_action.host}.
                  {t.pending_action.typed && <> Text: "{t.pending_action.typed}".</>}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {t.status === "needs_approval" && (<>
                  <Button size="sm" disabled={busy === t.id} onClick={() => act(t.id, { action: "approve", task_id: t.id }, "Approved")}><Check className="mr-1 h-4 w-4" />Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => act(t.id, { action: "approve", task_id: t.id, decision: "deny" }, "Declined")}><X className="mr-1 h-4 w-4" />Decline</Button>
                </>)}
                {["queued", "running", "needs_approval", "needs_input"].includes(t.status) && t.live_url && (
                  <Button size="sm" variant="ghost" asChild><a href={t.live_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Watch live</a></Button>
                )}
                {["queued", "running", "needs_approval", "needs_input", "needs_login"].includes(t.status) && (
                  <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => act(t.id, { action: "cancel", task_id: t.id }, "Stopped")}><Square className="mr-1 h-4 w-4" />Stop</Button>
                )}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Saved sign-ins</h2>
          <p className="text-xs text-muted-foreground">You sign in yourself in a secure browser window. Ozlon never sees your password.</p>
          {logins.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/60 px-4 py-3">
              <div className="flex items-center gap-3"><KeyRound className="h-4 w-4 text-primary" /><div><p className="text-sm font-medium">{l.label}</p><p className="text-xs text-muted-foreground">{l.status === "active" ? "Signed in" : "Not finished"}</p></div></div>
              <Button size="icon" variant="ghost" aria-label={`Remove ${l.label}`} onClick={() => act(l.id, { action: "login_remove", login_id: l.id }, "Removed")}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {pending ? (
            <div className="space-y-2 rounded-2xl border border-primary/40 p-4 text-sm">
              <p>Sign in to {pending.domain} in the window that opened. Then come back and tap Done.</p>
              <div className="flex gap-2">
                <Button size="sm" asChild variant="outline"><a href={pending.url} target="_blank" rel="noopener noreferrer">Open again</a></Button>
                <Button size="sm" disabled={busy === "login"} onClick={finishLogin}>Done, I'm signed in</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input placeholder="Website, e.g. chase.com" value={site} onChange={(e) => setSite(e.target.value)} />
              <Button disabled={busy === "login" || !site.trim()} onClick={startLogin}><Plus className="mr-1 h-4 w-4" />Add</Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
