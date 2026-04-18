import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Check, Loader2, Trash2, ExternalLink, Sparkles, Zap, FileText, Image as ImageIcon, Film, Wrench, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ----------------------------------------------------------------------------
// Platform catalog — one entry per AI platform (NOT per model).
// `source` controls how the connection works:
//   - "lovable" : auto-connected via the Lovable AI Gateway baseline
//   - "byok"    : user pastes one API key, multiple models light up at once
//   - "edge"    : managed by an existing integration page (Higgsfield)
// ----------------------------------------------------------------------------

type Capability = "text" | "image" | "video" | "tools" | "voice";

interface Platform {
  id: string;
  label: string;
  blurb: string;
  capabilities: Capability[];
  source: "lovable" | "byok" | "edge";
  manageRoute?: string;
  // model_ids that count as "the user has connected this platform via BYOK"
  byokModelIds?: string[];
}

const PLATFORMS: Platform[] = [
  // Auto-connected via Lovable AI baseline. Cannot be disconnected.
  {
    id: "lovable-gemini",
    label: "Gemini (via Lovable)",
    blurb: "Google's multimodal family — text, image, and video.",
    capabilities: ["text", "image", "video", "tools"],
    source: "lovable",
  },
  {
    id: "lovable-openai",
    label: "OpenAI (via Lovable)",
    blurb: "GPT-5 family — strong tool use and reasoning.",
    capabilities: ["text", "tools"],
    source: "lovable",
  },
  // Edge-managed
  {
    id: "higgsfield",
    label: "Higgsfield AI",
    blurb: "Cinematic AI video & image generation.",
    capabilities: ["video", "image"],
    source: "edge",
    manageRoute: "/integrations/higgsfield",
  },
  // BYOK — user-pasted API key plugs whole platform into the gauntlet.
  {
    id: "gemini",
    label: "Gemini (your key)",
    blurb: "Power text + image + video with your own Google AI key.",
    capabilities: ["text", "image", "video", "tools"],
    source: "byok",
    byokModelIds: ["google/gemini-2.5-pro", "google/gemini-2.5-flash", "google/gemini-3-pro-image-preview", "google/veo-3-fast"],
  },
  {
    id: "openai",
    label: "OpenAI (your key)",
    blurb: "Bring your own OpenAI key for direct GPT-5 access.",
    capabilities: ["text", "tools", "voice"],
    source: "byok",
    byokModelIds: ["openai/gpt-5", "openai/gpt-5-mini", "openai/gpt-5-nano"],
  },
  {
    id: "anthropic",
    label: "Claude",
    blurb: "Anthropic's deep-reasoning, long-context model.",
    capabilities: ["text", "tools"],
    source: "byok",
    byokModelIds: ["anthropic/claude-opus-4", "anthropic/claude-sonnet-4"],
  },
  {
    id: "xai",
    label: "Grok",
    blurb: "xAI's witty, real-time reasoning model.",
    capabilities: ["text", "tools"],
    source: "byok",
    byokModelIds: ["xai/grok-4"],
  },
  {
    id: "mistral",
    label: "Mistral",
    blurb: "European open-weights frontier model.",
    capabilities: ["text", "tools"],
    source: "byok",
    byokModelIds: ["mistral/mistral-large-latest"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    blurb: "Cost-efficient reasoning model.",
    capabilities: ["text", "tools"],
    source: "byok",
    byokModelIds: ["deepseek/deepseek-chat"],
  },
];

// ----------------------------------------------------------------------------
// Roles for "What handles what?"
// ----------------------------------------------------------------------------

type RoleId = "planner" | "executor" | "summarizer" | "image_artist" | "video_director";

interface RoleDef {
  id: RoleId;
  label: string;
  blurb: string;
  Icon: typeof Brain;
  filterCap: Capability;
}

const ROLES: RoleDef[] = [
  { id: "planner",        label: "Quick thinking & routing",  blurb: "Decides which tool to run next.",            Icon: Zap,       filterCap: "text" },
  { id: "executor",       label: "Deep reasoning & tool use", blurb: "Runs your integrations and drafts replies.", Icon: Wrench,    filterCap: "tools" },
  { id: "summarizer",     label: "Summaries",                 blurb: "Compresses long transcripts.",               Icon: FileText,  filterCap: "text" },
  { id: "image_artist",   label: "Image creation",            blurb: "Generates and edits images.",                Icon: ImageIcon, filterCap: "image" },
  { id: "video_director", label: "Video creation",            blurb: "Generates short AI videos.",                 Icon: Film,      filterCap: "video" },
];

interface CustomModelRow {
  id: string;
  model_id: string;
  display_name: string;
  api_key_secret_name: string | null;
  capabilities: string[];
  enabled: boolean;
  metadata: Record<string, unknown> | null;
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

  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    if (!user) return;
    const [customRes, hfRes, prefsRes, logsRes] = await Promise.all([
      supabase.from("custom_models").select("id, model_id, display_name, api_key_secret_name, capabilities, enabled, metadata").eq("user_id", user.id),
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

  // ---- Platform connection state ----

  // Did the user connect this BYOK platform (any of its models present)?
  const byokConnectedRow = (p: Platform): CustomModelRow | undefined => {
    if (p.source !== "byok" || !p.byokModelIds) return undefined;
    return customModels.find((c) =>
      ((c.metadata?.platform_id as string) === p.id) ||
      p.byokModelIds!.includes(c.model_id)
    );
  };

  const isPlatformConnected = (p: Platform): boolean => {
    if (p.source === "lovable") return true;
    if (p.source === "edge" && p.id === "higgsfield") return connectedHF;
    if (p.source === "byok") return !!byokConnectedRow(p);
    return false;
  };

  const platformKeyDisplay = (p: Platform): string => {
    if (p.source === "lovable") return "Connected via Lovable AI";
    if (p.source === "edge" && p.id === "higgsfield" && connectedHF) return "Connected via your key";
    if (p.source === "byok") {
      const row = byokConnectedRow(p);
      const secret = row?.api_key_secret_name || "";
      const last4 = secret.startsWith("inline:") ? secret.slice(-4) : "••••";
      return `Connected via your key ••••${last4}`;
    }
    return "";
  };

  const connected = PLATFORMS.filter(isPlatformConnected);
  const notConnected = PLATFORMS.filter((p) => !isPlatformConnected(p));

  // ---- Models list for "What handles what?" dropdowns ----
  const allConnectedModels = useMemo(() => {
    // Start with Lovable AI baseline (every static model in the registry-equivalent map)
    const list: { id: string; label: string; cap: Capability[] }[] = [];
    // Lovable AI baseline is implicitly available — surface a curated subset
    if (isPlatformConnected(PLATFORMS[0])) { // lovable-gemini
      list.push(
        { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro · Lovable", cap: ["text", "tools"] },
        { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash · Lovable", cap: ["text", "tools"] },
        { id: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image · Lovable", cap: ["image"] },
        { id: "google/veo-3-fast", label: "Veo 3 Fast · Lovable", cap: ["video"] },
      );
    }
    if (isPlatformConnected(PLATFORMS[1])) { // lovable-openai
      list.push(
        { id: "openai/gpt-5", label: "GPT-5 · Lovable", cap: ["text", "tools"] },
        { id: "openai/gpt-5-mini", label: "GPT-5 Mini · Lovable", cap: ["text", "tools"] },
      );
    }
    // BYOK custom_models rows
    for (const c of customModels) {
      if (!c.enabled) continue;
      const cap = (c.capabilities || []).map(normalizeCap).filter(Boolean) as Capability[];
      list.push({
        id: c.model_id,
        label: `${c.display_name} · your key`,
        cap,
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customModels, connectedHF]);

  // ---- Actions ----
  const handleConnect = async (p: Platform) => {
    const key = (keyInputs[p.id] || "").trim();
    if (key.length < 8) {
      toast.error("Please paste a valid API key");
      return;
    }
    setBusyId(p.id);
    try {
      const { data, error } = await supabase.functions.invoke("connect-brain", {
        body: { action: "connect", platform_id: p.id, api_key: key },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Connect failed");
      toast.success(`${p.label} joined the gauntlet`);
      setKeyInputs((s) => ({ ...s, [p.id]: "" }));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async (p: Platform) => {
    if (p.source !== "byok") return;
    if (!confirm(`Remove ${p.label} from your gauntlet? Models from this platform will stop being available.`)) return;
    setBusyId(p.id);
    try {
      const { data, error } = await supabase.functions.invoke("connect-brain", {
        body: { action: "disconnect", platform_id: p.id },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Disconnect failed");
      toast.success(`${p.label} removed`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setBusyId(null);
    }
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
            <p className="text-xs text-muted-foreground">Plug in any AI. Snap it into the gauntlet.</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 space-y-10 pt-6">
        {/* ============ Section A — Connected Brains (Gauntlet) ============ */}
        <section>
          <div className="px-1 mb-3">
            <h2 className="text-sm font-semibold text-foreground">Connected Brains</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Live in your gauntlet. Each platform powers everything its capabilities cover.</p>
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
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    {p.capabilities.map((c) => <CapBadge key={c} cap={c} />)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{p.blurb}</p>
                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">{platformKeyDisplay(p)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {p.manageRoute && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => navigate(p.manageRoute!)}>
                      Manage <ExternalLink className="w-3 h-3" />
                    </Button>
                  )}
                  {p.source === "byok" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDisconnect(p)}
                      disabled={busyId === p.id}
                      title="Remove from gauntlet"
                    >
                      {busyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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
                Paste an API key. The whole platform — every capability it offers — joins the Infinity Router instantly.
              </p>
            </div>
            <div className="space-y-2">
              {notConnected.map((p) => (
                <div key={p.id} className="p-4 rounded-2xl bg-card/40 border border-dashed border-border/40">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-foreground">{p.label}</p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5 opacity-70">
                        {p.capabilities.map((c) => <CapBadge key={c} cap={c} muted />)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">{p.blurb}</p>
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
                        disabled={busyId === p.id || !(keyInputs[p.id] || "").trim()}
                        className="h-9"
                      >
                        {busyId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Snap in"}
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

const CAP_META: Record<string, { label: string; cls: string; mutedCls: string }> = {
  text:  { label: "Text",  cls: "bg-blue-500/10 text-blue-500",     mutedCls: "bg-muted/40 text-muted-foreground" },
  tools: { label: "Tools", cls: "bg-purple-500/10 text-purple-500", mutedCls: "bg-muted/40 text-muted-foreground" },
  image: { label: "Image", cls: "bg-pink-500/10 text-pink-500",     mutedCls: "bg-muted/40 text-muted-foreground" },
  video: { label: "Video", cls: "bg-amber-500/10 text-amber-500",   mutedCls: "bg-muted/40 text-muted-foreground" },
  voice: { label: "Voice", cls: "bg-emerald-500/10 text-emerald-500", mutedCls: "bg-muted/40 text-muted-foreground" },
};

const CapBadge = ({ cap, muted = false }: { cap: string; muted?: boolean }) => {
  const m = CAP_META[cap];
  if (!m) return null;
  return (
    <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded", muted ? m.mutedCls : m.cls)}>
      {m.label}
    </span>
  );
};

// Map registry capability names to Brain-page capability buckets used in dropdown filtering.
function normalizeCap(c: string): Capability | "" {
  if (c === "tools") return "tools";
  if (c === "image_gen") return "image";
  if (c === "video_gen") return "video";
  if (c === "vision" || c === "json" || c === "long_context" || c === "reasoning") return "text";
  return "";
}

export default ModelRouting;
