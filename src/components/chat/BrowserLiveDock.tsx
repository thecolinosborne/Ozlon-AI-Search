import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Hand, Loader2, Pause, Play, Square, Volume2, VolumeX, X, Globe } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { voiceService } from "@/services/voiceService";
import { cn } from "@/lib/utils";

type Step = { n: number; say?: string; summary?: string; ok?: boolean; at?: string };
type Task = {
  id: string; goal: string; status: string; phase: string | null; narration: string | null;
  plan: string[] | null; plan_index: number | null; steps: Step[] | null; step_count: number;
  live_url: string | null; result: string | null; question: string | null; error: string | null;
  created_at: string; updated_at: string;
};

const ACTIVE = ["queued", "running", "paused", "needs_approval", "needs_input", "needs_login"];
const LABEL: Record<string, string> = {
  queued: "Starting", running: "Working", paused: "Paused", needs_approval: "Waiting on you",
  needs_input: "Waiting on you", needs_login: "Waiting on you", done: "Done", failed: "Didn't finish", cancelled: "Stopped",
};

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("browser-agent", { body });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error);
  return data;
}

function elapsed(from: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Floating live view of the current browser job: window, plan checklist, narration, controls. */
export function BrowserLiveDock({ userId, voiceEnabled }: { userId?: string | null; voiceEnabled?: boolean }) {
  const [task, setTask] = useState<Task | null>(null);
  const [open, setOpen] = useState(true);
  const [muted, setMuted] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const spoken = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  useEffect(() => {
    if (!userId) return;
    let stop = false; let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const since = new Date(Date.now() - 3 * 60_000).toISOString();
        const { data } = await supabase.from("browser_tasks")
          .select("id,goal,status,phase,narration,plan,plan_index,steps,step_count,live_url,result,question,error,created_at,updated_at")
          .eq("user_id", userId).or(`status.in.(${ACTIVE.join(",")}),updated_at.gte.${since}`)
          .order("created_at", { ascending: false }).limit(1);
        if (!stop) setTask(((data?.[0] as unknown) as Task) || null);
      }
      if (!stop) t = setTimeout(tick, task && ACTIVE.includes(task.status) ? 1500 : 5000);
    };
    void tick();
    return () => { stop = true; clearTimeout(t); };
  }, [userId, task?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = !!task && ACTIVE.includes(task.status);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [active]);

  // Speak new narration lines (at most one every 4s) when voice is on.
  useEffect(() => {
    const line = task?.narration?.trim();
    if (!line || !voiceEnabled || muted || line === spoken.current.text) return;
    if (Date.now() - spoken.current.at < 4000 && task?.status === "running") return;
    spoken.current = { text: line, at: Date.now() };
    voiceService.speak(line).catch(() => {});
  }, [task?.narration, task?.status, voiceEnabled, muted]);

  if (!task || dismissed === task.id) return null;

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { await call({ ...body, task_id: task.id }); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const plan = Array.isArray(task.plan) ? task.plan : [];
  const idx = task.plan_index ?? 0;
  const finished = task.status === "done";
  const feed = (Array.isArray(task.steps) ? task.steps : []).slice(-4).reverse();
  const waiting = task.status.startsWith("needs_");
  const showLive = active && task.live_url && task.status !== "queued";

  return (
    <div className="fixed z-40 inset-x-2 top-16 md:inset-x-auto md:right-4 md:top-20 md:w-[440px]">
      <div className="rounded-2xl border border-border/60 bg-background/85 backdrop-blur-xl shadow-lg overflow-hidden">
        {/* Status bar */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className={cn("relative flex h-2.5 w-2.5 shrink-0")}>
            {task.status === "running" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />}
            <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full",
              finished ? "bg-primary" : waiting || task.status === "paused" ? "bg-accent-foreground/60" : task.status === "failed" ? "bg-destructive" : "bg-primary")} />
          </span>
          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">
              {task.status === "running" && task.phase === "thinking" ? "Thinking" : LABEL[task.status] || task.status}
              <span className="text-muted-foreground font-normal"> · {task.goal}</span>
            </p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
            {active ? elapsed(task.created_at, now) : ""}{task.step_count ? ` · ${task.step_count} steps` : ""}
          </span>
          {voiceEnabled && (
            <button aria-label={muted ? "Unmute narration" : "Mute narration"} onClick={() => setMuted((m) => !m)} className="p-1 text-muted-foreground hover:text-foreground">
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          )}
          <button aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)} className="p-1 text-muted-foreground hover:text-foreground">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {!active && (
            <button aria-label="Close" onClick={() => setDismissed(task.id)} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          )}
        </div>

        {/* Narration line, always visible */}
        {task.narration && (
          <p className="px-3 pb-2 text-sm text-foreground/90" aria-live="polite">{task.narration}</p>
        )}

        {open && (
          <div className="border-t border-border/50">
            {showLive && (
              <div className="relative aspect-video bg-muted">
                <iframe title="Live browser" src={task.live_url!} className="absolute inset-0 h-full w-full"
                  allow="clipboard-read; clipboard-write"
                  style={{ pointerEvents: task.status === "paused" || waiting ? "auto" : "none" }} />
              </div>
            )}
            {task.status === "queued" && (
              <div className="flex items-center gap-2 px-3 py-6 justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Opening a browser
              </div>
            )}

            {plan.length > 0 && (
              <ol className="px-3 py-2.5 space-y-1.5">
                {plan.map((p, i) => {
                  const done = finished || i < idx;
                  const current = !finished && i === idx && active;
                  return (
                    <li key={i} className={cn("flex items-center gap-2 text-sm", done ? "text-muted-foreground" : current ? "text-foreground" : "text-muted-foreground/70")}>
                      <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border shrink-0",
                        done ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary" : "border-border")}>
                        {done ? <Check className="h-3 w-3" /> : current ? <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> : null}
                      </span>
                      <span className={cn(done && "line-through decoration-muted-foreground/40")}>{p}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {feed.length > 0 && active && (
              <ul className="px-3 pb-2.5 space-y-0.5 text-xs text-muted-foreground">
                {feed.map((s) => (
                  <li key={s.n} className="truncate">{s.ok === false ? "Retrying: " : ""}{s.say || s.summary}</li>
                ))}
              </ul>
            )}

            {(task.question && waiting) && <p className="px-3 pb-2 text-sm">{task.question} Reply in chat.</p>}
            {finished && task.result && <p className="px-3 pb-3 text-sm whitespace-pre-wrap max-h-48 overflow-auto">{task.result}</p>}
            {task.status === "failed" && task.error && <p className="px-3 pb-3 text-sm text-destructive">{task.error}</p>}

            {active && (
              <div className="flex gap-2 px-3 pb-3">
                {task.status === "paused" ? (
                  <button disabled={busy} onClick={() => act({ action: "resume" })} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-primary text-primary-foreground text-sm py-1.5 disabled:opacity-60">
                    <Play className="h-3.5 w-3.5" /> Hand it back
                  </button>
                ) : (
                  <>
                    <button disabled={busy || waiting} onClick={() => act({ action: "pause" })} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-border text-sm py-1.5 disabled:opacity-50">
                      <Pause className="h-3.5 w-3.5" /> Pause
                    </button>
                    <button disabled={busy || waiting} onClick={() => act({ action: "pause", takeover: true })} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-border text-sm py-1.5 disabled:opacity-50">
                      <Hand className="h-3.5 w-3.5" /> Take over
                    </button>
                  </>
                )}
                <button disabled={busy} onClick={() => act({ action: "cancel" })} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border text-sm px-3 py-1.5 disabled:opacity-50">
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
