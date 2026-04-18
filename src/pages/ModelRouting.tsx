import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Check, Loader2, Trash2, ExternalLink, Brain, Sparkles, Zap, FileText, Image as ImageIcon, Film, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ----------------------------------------------------------------------------
// Provider catalog — what users can connect.
// "auto" providers are powered by Lovable AI (no key needed from user).
// "byok" providers need the user to paste an API key.
// ----------------------------------------------------------------------------

type Provider = {
  id: string;
  label: string;
  blurb: string;
  models: string[];          // model IDs that count as "this provider connected"
  capabilities: ("text" | "image" | "video" | "tools")[];
  source: "lovable" | "byok" | "edge"; // how it's powered
  presetId?: string;         // for byok providers, used by connect-brain
  manageRoute?: string;      // for edge-managed (e.g. higgsfield) providers
};

const PROVIDERS: Provider[] = [
  // --- Auto-connected via Lovable AI ---
  {
    id: "gemini",
    label: "Gemini",
    blurb: "Google's flagship multimodal models.",
    models: ["google/gemini-2.5-flash", "google/gemini-2.5-pro", "google/gemini-3.1-pro-preview", "google/gemini-3-flash-preview"],
    capabilities: ["text", "tools"],
    source: "lovable",
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT-5 family — strong tool use and reasoning.",
    models: ["openai/gpt-5", "openai/gpt-5-mini", "openai/gpt-5.2"],
    capabilities: ["text", "tools"],
    source: "lovable",
  },
  {
    id: "nano-banana",
    label: "Nano Banana",
    blurb: "Gemini image generation & editing.",
    models: ["google/gemini-2.5-flash-image", "google/gemini-3.1-flash-image-preview", "google/gemini-3-pro-image-preview"],
    capabilities: ["image"],
    source: "lovable",
  },
  {
    id: "veo",
    label: "Veo 3",
    blurb: "Google's text-to-video model.",
    models: ["google/veo-3-fast", "google/veo-3"],
    capabilities: ["video"],
    source: "lovable",
  },
  // --- Edge-function-managed ---
  {
    id: "higgsfield",
    label: "Higgsfield AI",
    blurb: "Cinematic AI video & image generation.",
    models: ["higgsfield/dop-standard"],
    capabilities: ["video", "image"],
    source: "edge",
    manageRoute: "/integrations/higgsfield",
  },
  // --- BYOK custom brains ---
  {
    id: "anthropic",
    label: "Claude",
    blurb: "Anthropic's reasoning & long-context model.",
    models: ["anthropic/claude-opus-4"],
    capabilities: ["text", "tools"],
    source: "byok",
    presetId: "anthropic",
  },
  {
    id: "xai",
    label: "Grok",
    blurb: "xAI's witty, real-time reasoning model.",
    models: ["xai/grok-4"],
    capabilities: ["text", "tools"],
    source: "byok",
    presetId: "xai",
  },
  {
    id: "mistral",
    label: "Mistral",
    blurb: "European open-weights frontier model.",
    models: ["mistral/mistral-large-latest"],
    capabilities: ["text", "tools"],
    source: "byok",
    presetId: "mistral",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    blurb: "Cost-efficient reasoning model.",
    models: ["deepseek/deepseek-chat"],
    capabilities: ["text", "tools"],
    source: "byok",
    presetId: "deepseek",
  },
];

// ----------------------------------------------------------------------------
// Roles — humanized agent overrides ("what handles what?")
// ----------------------------------------------------------------------------

type RoleDef = {
  id: "planner" | "executor" | "summarizer" | "image_artist" | "video_director";
  label: string;
  blurb: string;
  Icon: typeof Brain;
  filterCap: "text" | "image" | "video" | "tools";
};

const ROLES: RoleDef[] = [
  { id: "planner",        label: "Quick thinking & routing",  blurb: "Decides which tool to run next.",     Icon: Zap,        filterCap: "text" },
  { id: "executor",       label: "Deep reasoning & tool use", blurb: "Runs your integrations and drafts replies.", Icon: Wrench, filterCap: "tools" },
  { id: "summarizer",     label: "Summaries",                 blurb: "Compresses long transcripts.",        Icon: FileText,   filterCap: "text" },
  { id: "image_artist",   label: "Image creation",            blurb: "Generates and edits images.",         Icon: ImageIcon,  filterCap: "image" },
  { id: "video_director", label: "Video creation",            blurb: "Generates short AI videos.",          Icon: Film,       filterCap: "video" },
];

interface CustomModelRow {
  id: string;
  model_id: string;
  display_name: string;
  api_key_secret_name: string | null;
  capabilities: string[];
  enabled: boolean;
}

interface RoutingLogRow {
  agent: string;
  model_used: string;
  latency_ms: number | null;
  success: boolean;
}

// ----------------------------------------------------------------------------

const ModelRouting = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [connectedHF, setConnectedHF] = useState(false);
  const [customModels, setCustomModels] = useState<CustomModelRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<RoutingLogRow[]>([]);

  // Inline key input state per BYOK provider id
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const refresh = async () => {
    if (!user) return;
    const [customRes, hfRes, prefsRes, logsRes] = await Promise.all([
      supabase.from("custom_models").select("id, model_id, display_name, api_key_secret_name, capabilities, enabled").eq("user_id", user.id),
      supabase.from("integration_connections").select("id").eq("user_id", user.id).eq("provider", "higgsfield").eq("status", "connected").maybeSingle(),
      supabase.from("user_model_preferences").select("agent_overrides").eq("user_id", user.id).maybeSingle(),
      supabase.from("model_routing_log").select("agent, model_used, latency_ms, success").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200),
    ]);
    setCustomModels((customRes.data as CustomModelRow[]) || []);
    setConnectedHF(!!hfRes.data);
    setOverrides((prefsRes.data?.agent_overrides as Record<string, string>) || {});
    setLogs((logsRes.data as RoutingLogRow[]) || []);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---- Provider state derivation ----
  const isProviderConnected = (p: Provider): boolean => {
    if (p.source === "lovable") return true;
    if (p.source === "edge" && p.id === "higgsfield") return connectedHF;
    if (p.source === "byok") {
      return customModels.some((c) => c.model_id === p.models[0] && c.enabled);
    }
    return false;
  };

  const getProviderKeyDisplay = (p: Provider): string => {
    if (p.source === "lovable") return "LOVABLE_API_KEY ••••••••";
    if (p.source === "edge" && p.id === "higgsfield" && connectedHF) return "HIGGSFIELD_API_KEY ••••••••";
    if (p.source === "byok") {
      const row = customModels.find((c) => c.model_id === p.models[0]);
      const secret = row?.api_key_secret_name || "";
      const last4 = secret.startsWith("inline:") ? secret.slice(-4) : "••••";
      return `•••••••• ${last4}`;
    }
    return "";
  };

  const allConnectedModels = useMemo(() => {
    const list: { id: string; label: string; cap: ("text" | "image" | "video" | "tools")[] }[] = [];
    for (const p of PROVIDERS) {
      if (!isProviderConnected(p)) continue;
      for (const mid of p.models) {
        list.push({ id: mid, label: `${prettyModelLabel(mid)} · ${p.label}`, cap: p.capabilities });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedHF, customModels]);

  const connected = PROVIDERS.filter(isProviderConnected);
  const notConnected = PROVIDERS.filter((p) => !isProviderConnected(p));

  // ---- Actions ----
  const handleConnect = async (provider: Provider) => {
    const key = (keyInputs[provider.id] || "").trim();
    if (!provider.presetId) return;
    if (key.length < 8) {
      toast.error("Please paste a valid API key");
      return;
    }
    setConnectingId(provider.id);
    try {
      const { data, error } = await supabase.functions.invoke("connect-brain", {
        body: { action: "connect", preset_id: provider.presetId, api_key: key },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Connect failed");
      toast.success(`${provider.label} connected to your Infinity Router`);
      setKeyInputs((s) => ({ ...s, [provider.id]: "" }));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (p: Provider) => {
    if (p.source !== "byok") return;
    if (!confirm(`Disconnect ${p.label} from your Infinity Router?`)) return;
    const row = customModels.find((c) => c.model_id === p.models[0]);
    if (!row || !user) return;
    await supabase.from("custom_models").delete().eq("id", row.id);
    toast.success(`${p.label} disconnected`);
    refresh();
  };

  const handleRoleChange = async (roleId: string, modelId: string) => {
    if (!user) return;
    const next = { ...overrides };
    if (modelId === "auto") delete next[roleId];
    else next[roleId] = modelId;
    setOverrides(next);
    const { error } = await supabase
      .from("user_model_preferences")
      .upsert({ user_id: user.id, agent_overrides: next, mode: "balanced" }, { onConflict: "user_id" });
    if (error) toast.error("Couldn't save preference");
  };

  // ---- Telemetry ----
  const stats = useMemo(() => {
    const byRole: Record<string, { count: number; latSum: number; ok: number }> = {};
    for (const l of logs) {
      byRole[l.agent] ??= { count: 0, latSum: 0, ok: 0 };
      byRole[l.agent].count++;
      byRole[l.agent].latSum += l.latency_ms || 0;
      if (l.success) byRole[l.agent].ok++;
    }
    return byRole;
  }, [logs]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
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
            <h1 className="text-lg font-semibold text-foreground">The Brain</h1>
            <p className="text-xs text-muted-foreground">Connect AI models. Decide what handles what.</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 space-y-10 pt-6">
        {/* ============ Section A — Connected Brains ============ */}
        <section>
          <div className="px-1 mb-3">
            <h2 className="text-sm font-semibold text-foreground">Connected Brains</h2>
            <p className="text-xs text-muted-foreground mt-0.5">These AIs are live and ready to think for you.</p>
          </div>
          <div className="space-y-2">
            {connected.map((p) => (
              <div key={p.id} className="p-4 rounded-2xl bg-card/60 border border-border/30 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm text-foreground">{p.label}</p>
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      <Check className="w-2.5 h-2.5" /> Connected
                    </span>
                    {p.capabilities.map((c) => (
                      <CapBadge key={c} cap={c} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{p.blurb}</p>
                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">{getProviderKeyDisplay(p)}</p>
                </div>
                <div className="flex items-center gap-1">
                  {p.manageRoute && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => navigate(p.manageRoute!)}>
                      Manage <ExternalLink className="w-3 h-3" />
                    </Button>
                  )}
                  {p.source === "byok" && (
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDisconnect(p)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ============ Section B — Add a Brain ============ */}
        {notConnected.length > 0 && (
          <section>
            <div className="px-1 mb-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add a Brain
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paste an API key to plug a new AI into your Infinity Router. It joins instantly.
              </p>
            </div>
            <div className="space-y-2">
              {notConnected.map((p) => (
                <div key={p.id} className="p-4 rounded-2xl bg-card/60 border border-border/30">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm text-foreground">{p.label}</p>
                        {p.capabilities.map((c) => (
                          <CapBadge key={c} cap={c} />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{p.blurb}</p>
                    </div>
                  </div>
                  {p.source === "byok" && (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder={`Paste ${p.label} API key`}
                        value={keyInputs[p.id] || ""}
                        onChange={(e) => setKeyInputs((s) => ({ ...s, [p.id]: e.target.value }))}
                        className="flex-1 h-9 text-sm font-mono"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleConnect(p)}
                        disabled={connectingId === p.id || !(keyInputs[p.id] || "").trim()}
                        className="h-9"
                      >
                        {connectingId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Connect"}
                      </Button>
                    </div>
                  )}
                  {p.source === "edge" && p.manageRoute && (
                    <Button size="sm" variant="outline" className="h-9" onClick={() => navigate(p.manageRoute!)}>
                      Set up {p.label}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ============ Section C — What handles what? ============ */}
        <section>
          <div className="px-1 mb-3">
            <h2 className="text-sm font-semibold text-foreground">What handles what?</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Pick a specific brain for a job, or leave it on Auto.</p>
          </div>
          <div className="space-y-2">
            {ROLES.map((role) => {
              const eligible = allConnectedModels.filter((m) => m.cap.includes(role.filterCap));
              const current = overrides[role.id] || "auto";
              const Icon = role.Icon;
              return (
                <div key={role.id} className="p-4 rounded-2xl bg-card/60 border border-border/30 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-foreground">{role.label}</p>
                      <p className="text-xs text-muted-foreground">{role.blurb}</p>
                    </div>
                  </div>
                  <select
                    value={current}
                    onChange={(e) => handleRoleChange(role.id, e.target.value)}
                    className="bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring max-w-[180px]"
                  >
                    <option value="auto">Auto (recommended)</option>
                    {eligible.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>

        {/* ============ Section D — Performance ============ */}
        {logs.length > 0 && (
          <section>
            <div className="px-1 mb-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> How it's been performing
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Recent reliability and speed by role.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ROLES.map((role) => {
                const s = stats[role.id];
                if (!s) return null;
                const avgMs = Math.round(s.latSum / s.count);
                const successPct = Math.round((s.ok / s.count) * 100);
                return (
                  <div key={role.id} className="p-3 rounded-xl bg-card/40 border border-border/20">
                    <p className="text-xs font-medium text-foreground">{role.label}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[11px] text-muted-foreground">{avgMs} ms avg</span>
                      <span className={cn("text-[11px]", successPct >= 95 ? "text-emerald-500" : successPct >= 80 ? "text-amber-500" : "text-destructive")}>
                        {successPct}% reliable
                      </span>
                      <span className="text-[11px] text-muted-foreground/60 ml-auto">{s.count} calls</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

const CAP_META: Record<string, { label: string; cls: string }> = {
  text:  { label: "text",  cls: "bg-blue-500/10 text-blue-500" },
  tools: { label: "tools", cls: "bg-purple-500/10 text-purple-500" },
  image: { label: "image", cls: "bg-pink-500/10 text-pink-500" },
  video: { label: "video", cls: "bg-amber-500/10 text-amber-500" },
};

const CapBadge = ({ cap }: { cap: string }) => {
  const m = CAP_META[cap];
  if (!m) return null;
  return (
    <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded", m.cls)}>
      {m.label}
    </span>
  );
};

function prettyModelLabel(id: string): string {
  // "google/gemini-2.5-pro" -> "Gemini 2.5 Pro"
  const tail = id.split("/").pop() || id;
  return tail
    .split("-")
    .map((w) => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/preview/gi, "(preview)");
}

export default ModelRouting;
