import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowLeft, Compass, Mountain, Gauge, AlertCircle, ClipboardCheck,
  Check, TrendingUp, TrendingDown, Minus, MessageCircle,
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

  const solveIssue = async (issue: Issue) => {
    const { error } = await supabase
      .from("life_issues" as any)
      .update({ status: "solved", solved_at: new Date().toISOString() } as any)
      .eq("id", issue.id);
    if (error) {
      toast({ title: "Could not solve issue", description: error.message, variant: "destructive" });
      return;
    }
    setIssues((prev) => prev.filter((i) => i.id !== issue.id));
    toast({ title: "Issue solved", description: issue.title });
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
    <div className="min-h-screen bg-background text-foreground pb-24">
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
        {!loading && vision && (
          <section className="p-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Compass className="w-4 h-4" /> Vision
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
          </section>
        )}

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
              rocks.map((rock) => {
                const progress = Math.max(0, Math.min(100, rock.progress ?? 0));
                const done = rock.status === "done" || rock.status === "complete";
                return (
                  <div key={rock.id} className="p-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={cn("font-medium", done && "line-through text-muted-foreground")}>{rock.title}</p>
                        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-0.5">
                          {rock.domain && <span className="capitalize">{rock.domain}</span>}
                          {rock.due_date && <span>Due {new Date(rock.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                        </div>
                      </div>
                      <span className="text-sm font-medium text-muted-foreground shrink-0">{progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", done ? "bg-emerald-500" : "bg-primary")}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    {rock.measurable && <p className="text-xs text-muted-foreground">Done when: {rock.measurable}</p>}
                  </div>
                );
              })
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
                {metrics.map((m) => {
                  const hist = latestByMetric.get(m.id) || [];
                  const latest = hist[0];
                  const prev = hist[1];
                  const met = latest ? targetMet(latest.value, m.target, m.direction) : null;
                  const trend = latest && prev
                    ? latest.value > prev.value ? "up" : latest.value < prev.value ? "down" : "flat"
                    : null;
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Target {m.target ?? "—"}{m.unit ? ` ${m.unit}` : ""}
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
                    </div>
                  );
                })}
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
                <div key={issue.id} className="p-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md">
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
                      onClick={() => solveIssue(issue)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-muted/50 hover:bg-muted shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" /> Solve
                    </button>
                  </div>
                </div>
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
