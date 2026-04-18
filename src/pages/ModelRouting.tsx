import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Scale, Sparkles, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type RoutingMode = "speed" | "balanced" | "quality";
type AgentName = "planner" | "executor" | "classifier" | "summarizer";

// Mirror of supabase/functions/_shared/model-registry.ts (display only)
const MODELS = [
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tier: "Nano", caps: ["json"] },
  { id: "google/gemini-2.5-flash",      label: "Gemini 2.5 Flash",      tier: "Flash", caps: ["tools", "json", "vision"] },
  { id: "google/gemini-2.5-pro",        label: "Gemini 2.5 Pro",        tier: "Pro",  caps: ["tools", "vision", "reasoning"] },
  { id: "openai/gpt-5-nano",            label: "GPT-5 Nano",            tier: "Nano", caps: ["tools"] },
  { id: "openai/gpt-5-mini",            label: "GPT-5 Mini",            tier: "Flash", caps: ["tools", "reasoning"] },
  { id: "openai/gpt-5",                 label: "GPT-5",                 tier: "Standard", caps: ["tools", "vision", "reasoning"] },
  { id: "openai/gpt-5.2",               label: "GPT-5.2",               tier: "Pro",  caps: ["tools", "vision", "reasoning"] },
];

const AGENTS: { id: AgentName; label: string; description: string }[] = [
  { id: "planner",    label: "Planner",    description: "Routes requests, picks integrations" },
  { id: "executor",   label: "Executor",   description: "Runs tool calls, drafts responses" },
  { id: "classifier", label: "Classifier", description: "Quick intent detection" },
  { id: "summarizer", label: "Summarizer", description: "Compresses long context" },
];

const MODE_META: Record<RoutingMode, { icon: typeof Zap; label: string; tagline: string }> = {
  speed:    { icon: Zap,      label: "Speed",    tagline: "Cheapest, fastest. Best for high-volume." },
  balanced: { icon: Scale,    label: "Balanced", tagline: "Smart defaults. Recommended." },
  quality:  { icon: Sparkles, label: "Quality",  tagline: "Frontier models on every turn." },
};

interface RoutingLogRow {
  agent: string;
  model_used: string;
  latency_ms: number | null;
  success: boolean;
  fallback_used: boolean;
  created_at: string;
}

const ModelRouting = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<RoutingMode>("balanced");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<RoutingLogRow[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [prefsRes, logsRes] = await Promise.all([
        supabase
          .from("user_model_preferences")
          .select("mode, agent_overrides, disabled_models")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("model_routing_log")
          .select("agent, model_used, latency_ms, success, fallback_used, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (cancelled) return;
      const prefs = prefsRes.data;
      if (prefs) {
        setMode((prefs.mode as RoutingMode) || "balanced");
        setOverrides((prefs.agent_overrides as Record<string, string>) || {});
        setDisabled(new Set((prefs.disabled_models as string[]) || []));
      }
      setLogs((logsRes.data as RoutingLogRow[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const save = async (next: {
    mode?: RoutingMode;
    agent_overrides?: Record<string, string>;
    disabled_models?: string[];
  }) => {
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      mode: next.mode ?? mode,
      agent_overrides: next.agent_overrides ?? overrides,
      disabled_models: next.disabled_models ?? Array.from(disabled),
    };
    const { error } = await supabase
      .from("user_model_preferences")
      .upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast.error("Failed to save preferences");
      console.error(error);
    }
  };

  const handleMode = (m: RoutingMode) => {
    setMode(m);
    save({ mode: m });
    toast.success(`Routing mode: ${MODE_META[m].label}`);
  };

  const handleOverride = (agent: AgentName, modelId: string) => {
    const next = { ...overrides };
    if (modelId === "auto") delete next[agent];
    else next[agent] = modelId;
    setOverrides(next);
    save({ agent_overrides: next });
  };

  const handleToggleModel = (id: string, enabled: boolean) => {
    const next = new Set(disabled);
    if (enabled) next.delete(id);
    else next.add(id);
    setDisabled(next);
    save({ disabled_models: Array.from(next) });
  };

  // Telemetry aggregations (last 24h)
  const stats = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = logs.filter((l) => new Date(l.created_at).getTime() > dayAgo);
    const byAgent: Record<string, { count: number; latencySum: number; fallbacks: number; successes: number }> = {};
    const byModel: Record<string, number> = {};
    for (const l of recent) {
      byAgent[l.agent] ??= { count: 0, latencySum: 0, fallbacks: 0, successes: 0 };
      byAgent[l.agent].count++;
      byAgent[l.agent].latencySum += l.latency_ms || 0;
      if (l.fallback_used) byAgent[l.agent].fallbacks++;
      if (l.success) byAgent[l.agent].successes++;
      byModel[l.model_used] = (byModel[l.model_used] || 0) + 1;
    }
    return { totalCalls: recent.length, byAgent, byModel };
  }, [logs]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 pb-24">
      <header className="border-b border-border/50 px-4 py-4 safe-area-top">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/settings")}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Intelligence Routing</h1>
            <p className="text-xs text-muted-foreground">
              {saving ? "Saving…" : "Pick which models power your AI"}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 space-y-8 pt-6">
        {/* Mode selector */}
        <section>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">
            Mode
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(MODE_META) as RoutingMode[]).map((m) => {
              const meta = MODE_META[m];
              const Icon = meta.icon;
              const active = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => handleMode(m)}
                  className={cn(
                    "p-4 rounded-2xl border transition-all text-left",
                    active
                      ? "bg-primary/10 border-primary/40 shadow-sm"
                      : "bg-card/60 border-border/30 hover:bg-card/80",
                  )}
                >
                  <Icon className={cn("w-5 h-5 mb-2", active ? "text-primary" : "text-foreground/70")} strokeWidth={1.5} />
                  <p className="font-medium text-sm text-foreground">{meta.label}</p>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2 px-1">{MODE_META[mode].tagline}</p>
        </section>

        {/* Per-agent overrides */}
        <section>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">
            Per-Agent Override
          </h2>
          <div className="space-y-2">
            {AGENTS.map((agent) => {
              const current = overrides[agent.id] || "auto";
              const eligibleModels = MODELS.filter((m) => {
                if (agent.id === "executor") return m.caps.includes("tools");
                if (agent.id === "planner" || agent.id === "classifier") return m.caps.includes("json") || m.caps.includes("tools");
                return true;
              });
              return (
                <div
                  key={agent.id}
                  className="p-4 rounded-2xl bg-card/60 border border-border/30 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground">{agent.label}</p>
                    <p className="text-xs text-muted-foreground">{agent.description}</p>
                  </div>
                  <select
                    value={current}
                    onChange={(e) => handleOverride(agent.id, e.target.value)}
                    className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring max-w-[180px]"
                  >
                    <option value="auto">Auto</option>
                    {eligibleModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>

        {/* Available models */}
        <section>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">
            Available Models
          </h2>
          <div className="space-y-2">
            {MODELS.map((m) => {
              const enabled = !disabled.has(m.id);
              return (
                <div
                  key={m.id}
                  className="p-4 rounded-2xl bg-card/60 border border-border/30 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm text-foreground">{m.label}</p>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                        {m.tier}
                      </span>
                    </div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {m.caps.map((c) => (
                        <span key={c} className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Switch checked={enabled} onCheckedChange={(v) => handleToggleModel(m.id, v)} />
                </div>
              );
            })}
          </div>
        </section>

        {/* Telemetry */}
        <section>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" />
            Last 24 Hours · {stats.totalCalls} calls
          </h2>
          {stats.totalCalls === 0 ? (
            <div className="p-4 rounded-2xl bg-card/60 border border-border/30 text-sm text-muted-foreground">
              No routing activity yet. Send a chat message to populate telemetry.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-card/60 border border-border/30">
                <p className="text-xs text-muted-foreground mb-2">By Agent</p>
                <div className="space-y-2">
                  {Object.entries(stats.byAgent).map(([agent, s]) => (
                    <div key={agent} className="flex items-center justify-between text-sm">
                      <span className="text-foreground capitalize">{agent}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {s.count} · avg {Math.round(s.latencySum / Math.max(s.count, 1))}ms
                        {s.fallbacks > 0 && <span className="text-amber-500 ml-2">· {s.fallbacks} fallback{s.fallbacks > 1 ? "s" : ""}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-card/60 border border-border/30">
                <p className="text-xs text-muted-foreground mb-2">Model Usage</p>
                <div className="space-y-2">
                  {Object.entries(stats.byModel)
                    .sort(([, a], [, b]) => b - a)
                    .map(([modelId, count]) => (
                      <div key={modelId} className="flex items-center justify-between text-sm">
                        <span className="text-foreground truncate">{modelId}</span>
                        <span className="text-muted-foreground tabular-nums">{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <Button variant="ghost" onClick={() => navigate("/settings")} className="w-full">
          Done
        </Button>
      </div>
    </div>
  );
};

export default ModelRouting;
