import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Scale, Sparkles, Activity, Plus, Trash2, Gem } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type RoutingMode = "speed" | "balanced" | "quality";
type AgentName = "planner" | "executor" | "classifier" | "summarizer" | "image_artist";

const STATIC_MODELS = [
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tier: "Nano", caps: ["json"] },
  { id: "google/gemini-2.5-flash",      label: "Gemini 2.5 Flash",      tier: "Flash", caps: ["tools", "json", "vision"] },
  { id: "google/gemini-2.5-pro",        label: "Gemini 2.5 Pro",        tier: "Pro",  caps: ["tools", "vision", "reasoning"] },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", tier: "Flash", caps: ["tools", "json", "vision"] },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", tier: "Pro",  caps: ["tools", "vision", "reasoning"] },
  { id: "google/gemini-2.5-flash-image", label: "Nano Banana", tier: "Flash", caps: ["image_gen"] },
  { id: "google/gemini-3.1-flash-image-preview", label: "Nano Banana 2", tier: "Flash", caps: ["image_gen"] },
  { id: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image", tier: "Pro", caps: ["image_gen"] },
  { id: "openai/gpt-5-nano",            label: "GPT-5 Nano",            tier: "Nano", caps: ["tools"] },
  { id: "openai/gpt-5-mini",            label: "GPT-5 Mini",            tier: "Flash", caps: ["tools", "reasoning"] },
  { id: "openai/gpt-5",                 label: "GPT-5",                 tier: "Standard", caps: ["tools", "vision", "reasoning"] },
  { id: "openai/gpt-5.2",               label: "GPT-5.2",               tier: "Pro",  caps: ["tools", "vision", "reasoning"] },
];

const AGENTS: { id: AgentName; label: string; description: string }[] = [
  { id: "planner",      label: "Planner",      description: "Routes requests, picks integrations" },
  { id: "executor",     label: "Executor",     description: "Runs tool calls, drafts responses" },
  { id: "classifier",   label: "Classifier",   description: "Quick intent detection" },
  { id: "summarizer",   label: "Summarizer",   description: "Compresses long context" },
  { id: "image_artist", label: "Image Artist", description: "Generates and edits images" },
];

const MODE_META: Record<RoutingMode, { icon: typeof Zap; label: string; tagline: string }> = {
  speed:    { icon: Zap,      label: "Speed",    tagline: "Cheapest, fastest. Best for high-volume." },
  balanced: { icon: Scale,    label: "Balanced", tagline: "Smart defaults. Recommended." },
  quality:  { icon: Sparkles, label: "Quality",  tagline: "Frontier models on every turn." },
};

const ALL_CAPS = ["tools", "json", "vision", "long_context", "reasoning", "image_gen"];

interface RoutingLogRow {
  agent: string;
  model_used: string;
  latency_ms: number | null;
  success: boolean;
  fallback_used: boolean;
  created_at: string;
}

interface CustomModel {
  id: string;
  model_id: string;
  display_name: string;
  gateway_url: string;
  api_key_secret_name: string | null;
  context_window: number;
  cost_per_1k_in: number;
  cost_per_1k_out: number;
  avg_latency_ms: number;
  capabilities: string[];
  tier: string;
  fallback_model_id: string | null;
  enabled: boolean;
}

const emptyStone: Omit<CustomModel, "id"> = {
  model_id: "",
  display_name: "",
  gateway_url: "https://ai.gateway.lovable.dev/v1/chat/completions",
  api_key_secret_name: null,
  context_window: 128000,
  cost_per_1k_in: 0,
  cost_per_1k_out: 0,
  avg_latency_ms: 1000,
  capabilities: ["tools"],
  tier: "standard",
  fallback_model_id: null,
  enabled: true,
};

const ModelRouting = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<RoutingMode>("balanced");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<RoutingLogRow[]>([]);
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [stoneOpen, setStoneOpen] = useState(false);
  const [draftStone, setDraftStone] = useState<Omit<CustomModel, "id">>(emptyStone);

  const refreshCustomModels = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("custom_models")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setCustomModels((data as CustomModel[]) || []);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [prefsRes, logsRes, customRes] = await Promise.all([
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
        supabase
          .from("custom_models")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const prefs = prefsRes.data;
      if (prefs) {
        setMode((prefs.mode as RoutingMode) || "balanced");
        setOverrides((prefs.agent_overrides as Record<string, string>) || {});
        setDisabled(new Set((prefs.disabled_models as string[]) || []));
      }
      setLogs((logsRes.data as RoutingLogRow[]) || []);
      setCustomModels((customRes.data as CustomModel[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const allModels = useMemo(
    () => [
      ...STATIC_MODELS,
      ...customModels.map((c) => ({
        id: c.model_id,
        label: c.display_name + " ✦",
        tier: c.tier.charAt(0).toUpperCase() + c.tier.slice(1),
        caps: c.capabilities,
      })),
    ],
    [customModels],
  );

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

  const handleSaveStone = async () => {
    if (!user) return;
    if (!draftStone.model_id || !draftStone.display_name) {
      toast.error("Model ID and display name required");
      return;
    }
    const { error } = await supabase.from("custom_models").upsert(
      { user_id: user.id, ...draftStone },
      { onConflict: "user_id,model_id" },
    );
    if (error) {
      toast.error(`Failed to add stone: ${error.message}`);
      return;
    }
    toast.success(`Stone "${draftStone.display_name}" socketed`);
    setStoneOpen(false);
    setDraftStone(emptyStone);
    refreshCustomModels();
  };

  const handleToggleStone = async (stone: CustomModel) => {
    await supabase.from("custom_models").update({ enabled: !stone.enabled }).eq("id", stone.id);
    refreshCustomModels();
  };

  const handleDeleteStone = async (stone: CustomModel) => {
    if (!confirm(`Remove ${stone.display_name}?`)) return;
    await supabase.from("custom_models").delete().eq("id", stone.id);
    toast.success("Stone removed");
    refreshCustomModels();
  };

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
          <button onClick={() => navigate("/settings")} className="p-2 hover:bg-muted rounded-full transition-colors">
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
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">Mode</h2>
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
                    active ? "bg-primary/10 border-primary/40 shadow-sm" : "bg-card/60 border-border/30 hover:bg-card/80",
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
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">Per-Agent Override</h2>
          <div className="space-y-2">
            {AGENTS.map((agent) => {
              const current = overrides[agent.id] || "auto";
              const eligibleModels = allModels.filter((m) => {
                if (agent.id === "executor") return m.caps.includes("tools");
                if (agent.id === "image_artist") return m.caps.includes("image_gen");
                if (agent.id === "planner" || agent.id === "classifier") return m.caps.includes("json") || m.caps.includes("tools");
                return true;
              });
              return (
                <div key={agent.id} className="p-4 rounded-2xl bg-card/60 border border-border/30 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground">{agent.label}</p>
                    <p className="text-xs text-muted-foreground">{agent.description}</p>
                  </div>
                  <select
                    value={current}
                    onChange={(e) => handleOverride(agent.id, e.target.value)}
                    className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring max-w-[200px]"
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
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">Available Models</h2>
          <div className="space-y-2">
            {STATIC_MODELS.map((m) => {
              const enabled = !disabled.has(m.id);
              return (
                <div key={m.id} className="p-4 rounded-2xl bg-card/60 border border-border/30 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm text-foreground">{m.label}</p>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                        {m.tier}
                      </span>
                    </div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {m.caps.map((c) => (
                        <span key={c} className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">{c}</span>
                      ))}
                    </div>
                  </div>
                  <Switch checked={enabled} onCheckedChange={(v) => handleToggleModel(m.id, v)} />
                </div>
              );
            })}
          </div>
        </section>

        {/* STONE SOCKET — pluggable custom LLMs */}
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Gem className="w-3.5 h-3.5" />
              Stone Socket · Custom Models
            </h2>
            <Dialog open={stoneOpen} onOpenChange={setStoneOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <Plus className="w-3 h-3" /> Add Stone
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Socket a new Stone</DialogTitle>
                  <DialogDescription>
                    Plug any model into Ozlon. Defaults to the Lovable AI Gateway — leave the API key blank to use it.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label htmlFor="model_id" className="text-xs">Model ID</Label>
                    <Input id="model_id" placeholder="e.g. anthropic/claude-opus-4"
                      value={draftStone.model_id}
                      onChange={(e) => setDraftStone({ ...draftStone, model_id: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="display_name" className="text-xs">Display Name</Label>
                    <Input id="display_name" placeholder="Claude Opus 4"
                      value={draftStone.display_name}
                      onChange={(e) => setDraftStone({ ...draftStone, display_name: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="gateway" className="text-xs">Gateway URL</Label>
                    <Input id="gateway"
                      value={draftStone.gateway_url}
                      onChange={(e) => setDraftStone({ ...draftStone, gateway_url: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="secret" className="text-xs">API Key Secret Name (optional)</Label>
                    <Input id="secret" placeholder="ANTHROPIC_API_KEY"
                      value={draftStone.api_key_secret_name ?? ""}
                      onChange={(e) => setDraftStone({ ...draftStone, api_key_secret_name: e.target.value || null })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Tier</Label>
                      <select
                        value={draftStone.tier}
                        onChange={(e) => setDraftStone({ ...draftStone, tier: e.target.value })}
                        className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm h-10"
                      >
                        <option value="nano">Nano</option>
                        <option value="flash">Flash</option>
                        <option value="standard">Standard</option>
                        <option value="pro">Pro</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Context Window</Label>
                      <Input type="number" value={draftStone.context_window}
                        onChange={(e) => setDraftStone({ ...draftStone, context_window: Number(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <Label className="text-xs">Cost / 1k in ($)</Label>
                      <Input type="number" step="0.0001" value={draftStone.cost_per_1k_in}
                        onChange={(e) => setDraftStone({ ...draftStone, cost_per_1k_in: Number(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <Label className="text-xs">Cost / 1k out ($)</Label>
                      <Input type="number" step="0.0001" value={draftStone.cost_per_1k_out}
                        onChange={(e) => setDraftStone({ ...draftStone, cost_per_1k_out: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Capabilities</Label>
                    <div className="flex gap-1 flex-wrap mt-1">
                      {ALL_CAPS.map((cap) => {
                        const on = draftStone.capabilities.includes(cap);
                        return (
                          <button
                            key={cap}
                            type="button"
                            onClick={() =>
                              setDraftStone({
                                ...draftStone,
                                capabilities: on
                                  ? draftStone.capabilities.filter((c) => c !== cap)
                                  : [...draftStone.capabilities, cap],
                              })
                            }
                            className={cn(
                              "text-[11px] px-2 py-1 rounded-md border transition-colors",
                              on ? "bg-primary/15 border-primary/40 text-foreground" : "bg-muted/30 border-border/40 text-muted-foreground",
                            )}
                          >
                            {cap}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Fallback Model (optional)</Label>
                    <select
                      value={draftStone.fallback_model_id ?? ""}
                      onChange={(e) => setDraftStone({ ...draftStone, fallback_model_id: e.target.value || null })}
                      className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm h-10"
                    >
                      <option value="">None</option>
                      {STATIC_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setStoneOpen(false)}>Cancel</Button>
                  <Button onClick={handleSaveStone}>Socket Stone</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {customModels.length === 0 ? (
            <div className="p-4 rounded-2xl bg-card/40 border border-dashed border-border/40 text-sm text-muted-foreground">
              No custom stones socketed. Add Anthropic, xAI, Mistral, or any OpenAI-compatible model — it appears in the agent dropdowns instantly.
            </div>
          ) : (
            <div className="space-y-2">
              {customModels.map((stone) => (
                <div key={stone.id} className="p-4 rounded-2xl bg-card/60 border border-border/30 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm text-foreground truncate">{stone.display_name}</p>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                        {stone.tier}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{stone.model_id}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {stone.capabilities.map((c) => (
                        <span key={c} className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">{c}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={stone.enabled} onCheckedChange={() => handleToggleStone(stone)} />
                    <button onClick={() => handleDeleteStone(stone)} className="p-2 hover:bg-destructive/10 rounded-md transition-colors">
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                        {s.fallbacks > 0 && <span className="text-primary ml-2">· {s.fallbacks} fallback{s.fallbacks > 1 ? "s" : ""}</span>}
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

        <Button variant="ghost" onClick={() => navigate("/settings")} className="w-full">Done</Button>
      </div>
    </div>
  );
};

export default ModelRouting;
