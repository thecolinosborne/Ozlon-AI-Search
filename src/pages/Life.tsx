import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowLeft, Compass, Mountain, Gauge, AlertCircle, ClipboardCheck,
  Check, TrendingUp, TrendingDown, Minus, MessageCircle,
  Pencil, X, Plus, Minus as MinusIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface Vision {
  id: string;
  purpose: string | null;
  core_values: string[] | null;
  ten_year_target: string | null;
  three_year_picture: string | null;
  one_year_plan: string | null;
}

interface Rock {
  id: string;
  title: string;
  domain: string | null;
  quarter: string | null;
  status: string | null;
  progress: number | null;
  due_date: string | null;
  measurable: string | null;
}

interface Metric {
  id: string;
  name: string;
  domain: string | null;
  unit: string | null;
  target: number | null;
  direction: string | null;
  is_active: boolean | null;
}

interface Entry {
  metric_id: string;
  period_start: string;
  value: number;
}

interface Issue {
  id: string;
  title: string;
  domain: string | null;
  priority: number | null;
  status: string | null;
  solution: string | null;
  due_date: string | null;
  owner: string | null;
}

interface Review {
  id: string;
  period_start: string;
  period_end: string;
  summary: string | null;
}

function currentQuarter() {
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
}

function weekStart(d = new Date()) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday start
  date.setDate(date.getDate() - day);
  return date.toISOString().slice(0, 10);
}

function targetMet(value: number, target: number | null, direction: string | null) {
  if (target == null) return null;
  const belowGood = direction && /below|lte|down|max/i.test(direction);
  return belowGood ? value <= target : value >= target;
}

export default function Life() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [vision, setVision] = useState<Vision | null>(null);
  const [rocks, setRocks] = useState<Rock[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const quarter = useMemo(currentQuarter, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [v, r, m, e, i, rev] = await Promise.all([
        supabase.from("life_vision" as any).select("*").limit(1).maybeSingle(),
        supabase.from("life_rocks" as any).select("*").eq("quarter", quarter).order("created_at"),
        supabase.from("life_scorecard_metrics" as any).select("*").eq("is_active", true).order("sort_order"),
        supabase.from("life_scorecard_entries" as any).select("metric_id, period_start, value").order("period_start", { ascending: false }).limit(200),
        supabase.from("life_issues" as any).select("*").neq("status", "solved").order("priority", { ascending: false }),
        supabase.from("life_reviews" as any).select("*").order("period_end", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setVision((v.data as unknown as Vision) || null);
      setRocks((r.data as unknown as Rock[]) || []);
      setMetrics((m.data as unknown as Metric[]) || []);
      setEntries((e.data as unknown as Entry[]) || []);
      setIssues((i.data as unknown as Issue[]) || []);
      setReview((rev.data as unknown as Review) || null);
      setLoading(false);
    })();
  }, [user, quarter]);

  const latestByMetric = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const arr = map.get(e.metric_id) || [];
      if (arr.length < 4) arr.push(e);
      map.set(e.metric_id, arr);
    }
    return map;
  }, [entries]);

  /* ---------- Rock editing ---------- */

  const updateRock = async (id: string, patch: Partial<Rock>) => {
    const prev = rocks;
    setRocks((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("life_rocks" as any).update(patch as any).eq("id", id);
    if (error) {
      setRocks(prev);
      toast({ title: "Could not update rock", description: error.message, variant: "destructive" });
    }
  };

  const setRockProgress = (rock: Rock, progress: number) => {
    const clamped = Math.max(0, Math.min(100, progress));
    const patch: Partial<Rock> = { progress: clamped };
    if (clamped >= 100) patch.status = "done";
    else if (rock.status === "done" || rock.status === "complete") patch.status = "on_track";
    updateRock(rock.id, patch);
  };

  /* ---------- Scorecard logging ---------- */

  const logMetric = async (metric: Metric, value: number) => {
    const period = weekStart();
    const { error } = await supabase.from("life_scorecard_entries" as any).upsert(
      { metric_id: metric.id, period_start: period, value, user_id: user!.id } as any,
      { onConflict: "metric_id,period_start" }
    );
    if (error) {
      // fall back to plain insert if no unique constraint
      const { error: err2 } = await supabase.from("life_scorecard_entries" as any)
        .insert({ metric_id: metric.id, period_start: period, value, user_id: user!.id } as any);
      if (err2) {
        toast({ title: "Could not log number", description: err2.message, variant: "destructive" });
        return false;
      }
    }
    setEntries((prev) => [{ metric_id: metric.id, period_start: period, value }, ...prev.filter((e) => !(e.metric_id === metric.id && e.period_start === period))]);
    return true;
  };

  /* ---------- Issue solving ---------- */

  const solveIssue = async (issue: Issue, solution: string, owner: string, dueDate: string) => {
    const patch: any = {
      status: "solved",
      solved_at: new Date().toISOString(),
      solution: solution || null,
      owner: owner || null,
      due_date: dueDate || null,
    };
    const { error } = await supabase.from("life_issues" as any).update(patch).eq("id", issue.id);
    if (error) {
      toast({ title: "Could not solve issue", description: error.message, variant: "destructive" });
      return false;
    }
    setIssues((prev) => prev.filter((i) => i.id !== issue.id));
    toast({ title: "Issue solved", description: issue.title });
    return true;
  };

  /* ---------- Vision editing ---------- */

  const saveVision = async (v: Omit<Vision, "id">) => {
    if (vision?.id) {
      const { error } = await supabase.from("life_vision" as any).update(v as any).eq("id", vision.id);
      if (error) {
        toast({ title: "Could not save vision", description: error.message, variant: "destructive" });
        return false;
      }
      setVision({ id: vision.id, ...v });
    } else {
      const { data, error } = await supabase.from("life_vision" as any)
        .insert({ ...v, user_id: user!.id } as any).select().single();
      if (error) {
        toast({ title: "Could not save vision", description: error.message, variant: "destructive" });
        return false;
      }
      setVision(data as unknown as Vision);
    }
    toast({ title: "Vision saved" });
    return true;
  };

  const askInChat = (prompt: string) =>
    navigate(`/?intent=${encodeURIComponent(prompt)}`);

  const avgRockProgress = rocks.length
    ? Math.round(rocks.reduce((s, r) => s + Math.max(0, Math.min(100, r.progress ?? 0)), 0) / rocks.length)
    : null;

  const metricsHit = metrics.reduce(
    (acc, m) => {
      const latest = (latestByMetric.get(m.id) || [])[0];
      if (!latest) return acc;
      const met = targetMet(latest.value, m.target, m.direction);
      if (met === null) return acc;
      return { hit: acc.hit + (met ? 1 : 0), total: acc.total + 1 };
    },
    { hit: 0, total: 0 }
  );

  const hasAnything = !!vision || rocks.length > 0 || metrics.length > 0 || issues.length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground pb-24 md:pb-0">
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30 px-4 py-3">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button onClick={() => navigate("/")} className="p-2 -ml-2 rounded-xl hover:bg-muted/50">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold">Life OS</h1>
          <span className="ml-auto text-xs text-muted-foreground">{quarter}</span>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {!loading && hasAnything && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Rocks" value={avgRockProgress === null ? "—" : `${avgRockProgress}%`} hint={`${rocks.length} this quarter`} />
              <StatTile
                label="Scorecard"
                value={metricsHit.total ? `${metricsHit.hit}/${metricsHit.total}` : "—"}
                hint="targets hit"
              />
              <StatTile label="Issues" value={`${issues.length}`} hint="open" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => askInChat("Run my weekly Life OS review: score my rocks, scorecard and issues, then ask me what to change")}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
              >
                <ClipboardCheck className="w-4 h-4" /> Weekly review
              </button>
              <button
                onClick={() => askInChat("Update my Life OS: rock progress, this week's scorecard numbers, and any new issues")}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border/50 bg-card/60 text-sm font-medium hover:bg-muted/40"
              >
                <MessageCircle className="w-4 h-4" /> Update in chat
              </button>
            </div>
          </>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-muted/30 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {!loading && !vision && rocks.length === 0 && metrics.length === 0 && issues.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <Compass className="w-12 h-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground">Your life operating system is not set up yet</p>
            <button
              onClick={() => askInChat("Help me set up my life vision, rocks, and scorecard")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
            >
              <MessageCircle className="w-4 h-4" /> Set it up in chat
            </button>
          </div>
        )}

        {/* Vision */}
        {!loading && (vision ? (
          <VisionCard vision={vision} onSave={saveVision} />
        ) : (
          <section className="p-4 rounded-2xl border border-border/30 bg-muted/20 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No vision written yet</p>
            <VisionEditorButton onSave={saveVision} />
          </section>
        ))}

        {/* Rocks */}
        {!loading && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground px-1">
              <Mountain className="w-4 h-4" /> Rocks — {quarter}
            </div>
            {rocks.length === 0 ? (
              <EmptyCard
                text="No rocks set for this quarter"
                actionLabel="Set rocks in chat"
                onAction={() => askInChat(`Help me set my rocks for ${quarter}`)}
              />
            ) : (
              rocks.map((rock) => (
                <RockCard key={rock.id} rock={rock} onProgress={setRockProgress} onUpdate={updateRock} />
              ))
            )}
          </section>
        )}

        {/* Scorecard */}
        {!loading && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground px-1">
              <Gauge className="w-4 h-4" /> Scorecard
            </div>
            {metrics.length === 0 ? (
              <EmptyCard
                text="No scorecard metrics yet"
                actionLabel="Pick metrics in chat"
                onAction={() => askInChat("Help me pick the weekly numbers for my scorecard")}
              />
            ) : (
              <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md divide-y divide-border/30">
                {metrics.map((m) => (
                  <MetricRow
                    key={m.id}
                    metric={m}
                    history={latestByMetric.get(m.id) || []}
                    onLog={logMetric}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Issues */}
        {!loading && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground px-1">
              <AlertCircle className="w-4 h-4" /> Open Issues
            </div>
            {issues.length === 0 ? (
              <div className="p-4 rounded-2xl border border-border/30 bg-muted/20 text-sm text-muted-foreground">
                Clear
              </div>
            ) : (
              issues.map((issue) => (
                <IssueCard key={issue.id} issue={issue} onSolve={solveIssue} />
              ))
            )}
          </section>
        )}

        {/* Latest review */}
        {!loading && review && (
          <section className="p-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ClipboardCheck className="w-4 h-4" /> Last review —{" "}
              {new Date(review.period_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </div>
            {review.summary && <p className="text-sm text-foreground/90 whitespace-pre-line">{review.summary}</p>}
          </section>
        )}
      </div>
    </div>
  );
}

/* ================= Vision ================= */

function VisionCard({ vision, onSave }: { vision: Vision; onSave: (v: Omit<Vision, "id">) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="p-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Compass className="w-4 h-4" /> Vision
        <button
          onClick={() => setEditing(true)}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground"
          aria-label="Edit vision"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
      {vision.purpose && <p className="text-foreground font-medium">{vision.purpose}</p>}
      {vision.core_values && vision.core_values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {vision.core_values.map((v) => (
            <span key={v} className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">{v}</span>
          ))}
        </div>
      )}
      {vision.one_year_plan && (
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">1-year plan</p>
          <p className="text-sm text-foreground/90">{vision.one_year_plan}</p>
        </div>
      )}
      {vision.three_year_picture && (
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">3-year picture</p>
          <p className="text-sm text-foreground/90">{vision.three_year_picture}</p>
        </div>
      )}
      {vision.ten_year_target && (
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">10-year target</p>
          <p className="text-sm text-foreground/90">{vision.ten_year_target}</p>
        </div>
      )}
      {editing && <VisionEditor vision={vision} onSave={onSave} onClose={() => setEditing(false)} />}
    </section>
  );
}

function VisionEditorButton({ onSave }: { onSave: (v: Omit<Vision, "id">) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-primary hover:underline shrink-0">
        Write it here
      </button>
      {open && <VisionEditor vision={null} onSave={onSave} onClose={() => setOpen(false)} />}
    </>
  );
}

function VisionEditor({
  vision,
  onSave,
  onClose,
}: {
  vision: Vision | null;
  onSave: (v: Omit<Vision, "id">) => Promise<boolean>;
  onClose: () => void;
}) {
  const [purpose, setPurpose] = useState(vision?.purpose ?? "");
  const [values, setValues] = useState((vision?.core_values ?? []).join(", "));
  const [oneYear, setOneYear] = useState(vision?.one_year_plan ?? "");
  const [threeYear, setThreeYear] = useState(vision?.three_year_picture ?? "");
  const [tenYear, setTenYear] = useState(vision?.ten_year_target ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const ok = await onSave({
      purpose: purpose.trim() || null,
      core_values: values.split(",").map((s) => s.trim()).filter(Boolean),
      one_year_plan: oneYear.trim() || null,
      three_year_picture: threeYear.trim() || null,
      ten_year_target: tenYear.trim() || null,
    });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-5 space-y-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Edit vision</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50"><X className="w-4 h-4" /></button>
        </div>
        <Field label="Purpose">
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} className={inputCls} placeholder="Why you do what you do" />
        </Field>
        <Field label="Core values (comma separated)">
          <input value={values} onChange={(e) => setValues(e.target.value)} className={inputCls} placeholder="Honesty, Discipline, Family" />
        </Field>
        <Field label="1-year plan">
          <textarea value={oneYear} onChange={(e) => setOneYear(e.target.value)} rows={2} className={inputCls} />
        </Field>
        <Field label="3-year picture">
          <textarea value={threeYear} onChange={(e) => setThreeYear(e.target.value)} rows={2} className={inputCls} />
        </Field>
        <Field label="10-year target">
          <textarea value={tenYear} onChange={(e) => setTenYear(e.target.value)} rows={2} className={inputCls} />
        </Field>
        <button
          onClick={save}
          disabled={saving}
          className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save vision"}
        </button>
      </div>
    </div>
  );
}

/* ================= Rocks ================= */

function RockCard({
  rock,
  onProgress,
  onUpdate,
}: {
  rock: Rock;
  onProgress: (rock: Rock, progress: number) => void;
  onUpdate: (id: string, patch: Partial<Rock>) => void;
}) {
  const progress = Math.max(0, Math.min(100, rock.progress ?? 0));
  const done = rock.status === "done" || rock.status === "complete";
  const [editingDate, setEditingDate] = useState(false);

  return (
    <div className="p-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-medium", done && "line-through text-muted-foreground")}>{rock.title}</p>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-0.5 items-center">
            {rock.domain && <span className="capitalize">{rock.domain}</span>}
            {editingDate ? (
              <input
                type="date"
                autoFocus
                defaultValue={rock.due_date ?? ""}
                onBlur={(e) => {
                  setEditingDate(false);
                  if (e.target.value && e.target.value !== rock.due_date) onUpdate(rock.id, { due_date: e.target.value });
                }}
                className="bg-muted/50 rounded px-1 py-0.5 text-xs"
              />
            ) : (
              <button onClick={() => setEditingDate(true)} className="hover:text-foreground transition-colors">
                {rock.due_date
                  ? `Due ${new Date(rock.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : "Set due date"}
              </button>
            )}
          </div>
        </div>
        <button
          onClick={() => onProgress(rock, done ? 90 : 100)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition-colors",
            done ? "bg-emerald-500/15 text-emerald-500" : "bg-muted/50 hover:bg-muted"
          )}
        >
          <Check className="w-3.5 h-3.5" /> {done ? "Done" : "Mark done"}
        </button>
      </div>

      {/* Interactive progress */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onProgress(rock, progress - 10)}
          className="p-1.5 rounded-lg bg-muted/50 hover:bg-muted shrink-0"
          aria-label="Decrease progress"
        >
          <MinusIcon className="w-3.5 h-3.5" />
        </button>
        <div className="relative flex-1">
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all pointer-events-none", done ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${progress}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => onProgress(rock, Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
            aria-label={`Progress for ${rock.title}`}
          />
        </div>
        <button
          onClick={() => onProgress(rock, progress + 10)}
          className="p-1.5 rounded-lg bg-muted/50 hover:bg-muted shrink-0"
          aria-label="Increase progress"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <span className="text-sm font-medium text-muted-foreground tabular-nums w-10 text-right shrink-0">{progress}%</span>
      </div>

      {rock.measurable && <p className="text-xs text-muted-foreground">Done when: {rock.measurable}</p>}
    </div>
  );
}

/* ================= Scorecard ================= */

function MetricRow({
  metric: m,
  history: hist,
  onLog,
}: {
  metric: Metric;
  history: Entry[];
  onLog: (m: Metric, value: number) => Promise<boolean>;
}) {
  const latest = hist[0];
  const prev = hist[1];
  const met = latest ? targetMet(latest.value, m.target, m.direction) : null;
  const trend = latest && prev
    ? latest.value > prev.value ? "up" : latest.value < prev.value ? "down" : "flat"
    : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const thisWeek = weekStart();
  const loggedThisWeek = latest?.period_start === thisWeek;

  const save = async () => {
    const value = Number(draft);
    if (Number.isNaN(value)) return;
    setSaving(true);
    const ok = await onLog(m, value);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setDraft("");
      toast({ title: `${m.name} logged`, description: `${value}${m.unit ? ` ${m.unit}` : ""} for this week` });
    }
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{m.name}</p>
          <p className="text-xs text-muted-foreground">
            Target {m.target ?? "—"}{m.unit ? ` ${m.unit}` : ""}
            {loggedThisWeek && <span className="ml-2 text-emerald-500">logged this week</span>}
          </p>
        </div>
        {trend && (
          trend === "up" ? <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          : trend === "down" ? <TrendingDown className="w-3.5 h-3.5 text-muted-foreground" />
          : <Minus className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            met === true && "text-emerald-500",
            met === false && "text-red-400"
          )}
        >
          {latest ? `${latest.value}${m.unit ? ` ${m.unit}` : ""}` : "—"}
        </span>
        <button
          onClick={() => { setEditing((v) => !v); setDraft(latest?.value?.toString() ?? ""); }}
          className={cn(
            "px-2.5 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors",
            editing ? "bg-muted" : "bg-primary/10 text-primary hover:bg-primary/20"
          )}
        >
          {editing ? "Cancel" : "Log"}
        </button>
      </div>
      {editing && (
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={`This week's ${m.name}`}
            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-muted/50 border border-border/40 text-sm outline-none focus:border-primary/50"
          />
          <button
            onClick={save}
            disabled={saving || draft.trim() === ""}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 shrink-0"
          >
            {saving ? "…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ================= Issues ================= */

function IssueCard({
  issue,
  onSolve,
}: {
  issue: Issue;
  onSolve: (issue: Issue, solution: string, owner: string, dueDate: string) => Promise<boolean>;
}) {
  const [solving, setSolving] = useState(false);
  const [solution, setSolution] = useState("");
  const [owner, setOwner] = useState(issue.owner ?? "");
  const [dueDate, setDueDate] = useState(issue.due_date ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const ok = await onSolve(issue, solution.trim(), owner.trim(), dueDate);
    setSaving(false);
    if (ok) setSolving(false);
  };

  return (
    <div className="p-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{issue.title}</p>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-0.5">
            {issue.domain && <span className="capitalize">{issue.domain}</span>}
            {issue.due_date && <span>Due {new Date(issue.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
            {issue.owner && <span>Owner: {issue.owner}</span>}
          </div>
        </div>
        <button
          onClick={() => setSolving((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-muted/50 hover:bg-muted shrink-0"
        >
          <Check className="w-3.5 h-3.5" /> {solving ? "Cancel" : "Solve"}
        </button>
      </div>
      {solving && (
        <div className="space-y-2 pt-1 border-t border-border/30">
          <textarea
            autoFocus
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            rows={2}
            placeholder="What's the solution?"
            className={inputCls}
          />
          <div className="flex gap-2">
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Owner"
              className={cn(inputCls, "flex-1")}
            />
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={cn(inputCls, "w-36 shrink-0")}
            />
          </div>
          <button
            onClick={submit}
            disabled={saving || !solution.trim()}
            className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Solving…" : "Solve issue"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ================= Shared ================= */

const inputCls = "w-full px-3 py-2 rounded-xl bg-muted/50 border border-border/40 text-sm outline-none focus:border-primary/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function EmptyCard({ text, actionLabel, onAction }: { text: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="p-4 rounded-2xl border border-border/30 bg-muted/20 flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{text}</p>
      <button onClick={onAction} className="text-xs font-medium text-primary hover:underline shrink-0">
        {actionLabel}
      </button>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="p-3 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
