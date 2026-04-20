import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, Check, Loader2, ExternalLink, Sparkles, Zap, FileText,
  Image as ImageIcon, Film, Wrench, Brain, Bot, Rocket, Cpu, Star, AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ----------------------------------------------------------------------------
// Platform catalog — one entry per AI platform (NOT per model).
// ----------------------------------------------------------------------------

type Capability = "text" | "image" | "video" | "tools" | "voice";

interface Platform {
  id: string;
  label: string;
  human_blurb: string;
  capabilities: Capability[];
  source: "lovable" | "byok" | "edge";
  manageRoute?: string;
  console_url?: string;
  key_prefix?: string;
  Glyph: typeof Brain;
  recommended?: boolean;
  byokModelIds?: string[];
}

const PLATFORMS: Platform[] = [
  // Auto-connected via Lovable AI baseline
  {
    id: "lovable-gemini",
    label: "Gemini",
    human_blurb: "Powered by Ozlon. Handles chat, images, and video out of the box.",
    capabilities: ["text", "image", "video", "tools"],
    source: "lovable",
    Glyph: Sparkles,
  },
  {
    id: "lovable-openai",
    label: "OpenAI",
    human_blurb: "Powered by Ozlon. Strong at conversation and taking actions.",
    capabilities: ["text", "tools"],
    source: "lovable",
    Glyph: Bot,
  },
  // Edge-managed
  {
    id: "higgsfield",
    label: "Higgsfield",
    human_blurb: "Cinematic brain. Creates filmlike video and image clips.",
    capabilities: ["video", "image"],
    source: "edge",
    manageRoute: "/integrations/higgsfield",
    console_url: "https://higgsfield.ai",
    Glyph: Film,
  },
  // BYOK
  {
    id: "gemini",
    label: "Gemini (your key)",
    human_blurb: "Google's brain. Great at images, video, and reading long documents.",
    capabilities: ["text", "image", "video", "tools"],
    source: "byok",
    console_url: "https://aistudio.google.com/apikey",
    key_prefix: "AIza",
    Glyph: Sparkles,
    recommended: true,
    byokModelIds: ["google/gemini-2.5-pro", "google/gemini-2.5-flash", "google/gemini-3-pro-image-preview", "google/veo-3-fast"],
  },
  {
    id: "openai",
    label: "OpenAI (your key)",
    human_blurb: "OpenAI's brain. The all-rounder — chat, actions, voice.",
    capabilities: ["text", "tools", "voice"],
    source: "byok",
    console_url: "https://platform.openai.com/api-keys",
    key_prefix: "sk-",
    Glyph: Bot,
    byokModelIds: ["openai/gpt-5", "openai/gpt-5-mini", "openai/gpt-5-nano"],
  },
  {
    id: "anthropic",
    label: "Claude",
    human_blurb: "Anthropic's brain. Thoughtful, careful, great at long writing.",
    capabilities: ["text", "tools"],
    source: "byok",
    console_url: "https://console.anthropic.com/settings/keys",
    key_prefix: "sk-ant-",
    Glyph: Brain,
    byokModelIds: ["anthropic/claude-opus-4", "anthropic/claude-sonnet-4"],
  },
  {
    id: "xai",
    label: "Grok",
    human_blurb: "xAI's brain. Witty and up to the minute on what's happening now.",
    capabilities: ["text", "tools"],
    source: "byok",
    console_url: "https://console.x.ai",
    key_prefix: "xai-",
    Glyph: Rocket,
    byokModelIds: ["xai/grok-4"],
  },
  {
    id: "mistral",
    label: "Mistral",
    human_blurb: "European brain. Fast, capable, privacy-minded.",
    capabilities: ["text", "tools"],
    source: "byok",
    console_url: "https://console.mistral.ai/api-keys",
    key_prefix: "",
    Glyph: Cpu,
    byokModelIds: ["mistral/mistral-large-latest"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    human_blurb: "Budget-friendly brain. Strong reasoning at a fraction of the cost.",
    capabilities: ["text", "tools"],
    source: "byok",
    console_url: "https://platform.deepseek.com/api_keys",
    key_prefix: "sk-",
    Glyph: Zap,
    byokModelIds: ["deepseek/deepseek-chat"],
  },
];

// ----------------------------------------------------------------------------
// Roles
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
  { id: "planner",        label: "Quick thinking",   blurb: "Decides what to do next.",                   Icon: Zap,       filterCap: "text" },
  { id: "executor",       label: "Doing the work",   blurb: "Runs your integrations and writes replies.", Icon: Wrench,    filterCap: "tools" },
  { id: "summarizer",     label: "Summaries",        blurb: "Compresses long transcripts.",               Icon: FileText,  filterCap: "text" },
  { id: "image_artist",   label: "Making images",    blurb: "Generates and edits pictures.",              Icon: ImageIcon, filterCap: "image" },
  { id: "video_director", label: "Making videos",    blurb: "Generates short AI clips.",                  Icon: Film,      filterCap: "video" },
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
  const [labelInputs, setLabelInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Platform | null>(null);

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

  const byokRow = (p: Platform): CustomModelRow | undefined => {
    if (p.source !== "byok" || !p.byokModelIds) return undefined;
    return customModels.find((c) =>
      ((c.metadata?.platform_id as string) === p.id) ||
      p.byokModelIds!.includes(c.model_id),
    );
  };

  const isPlatformConnected = (p: Platform): boolean => {
    if (p.source === "lovable") return true;
    if (p.source === "edge" && p.id === "higgsfield") return connectedHF;
    if (p.source === "byok") return !!byokRow(p);
    return false;
  };

  const platformNickname = (p: Platform): string | null => {
    const row = byokRow(p);
    return (row?.metadata?.label as string) || null;
  };

  const platformKeyTail = (p: Platform): string => {
    if (p.source === "lovable") return "Powered by Ozlon";
    if (p.source === "edge" && p.id === "higgsfield" && connectedHF) return "Using your key";
    if (p.source === "byok") {
      const row = byokRow(p);
      const secret = row?.api_key_secret_name || "";
      const last4 = secret.startsWith("inline:") ? secret.slice(-4) : "••••";
      return `Using your key ••••${last4}`;
    }
    return "";
  };

  const connected = PLATFORMS.filter(isPlatformConnected);
  const notConnected = PLATFORMS.filter((p) => !isPlatformConnected(p));
  const userHasPersonalBrain = customModels.length > 0 || connectedHF;

  // Models for "How your Brains work together" dropdowns
  const allConnectedModels = useMemo(() => {
    const list: { id: string; label: string; cap: Capability[] }[] = [];
    if (isPlatformConnected(PLATFORMS[0])) {
      list.push(
        { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro · Ozlon", cap: ["text", "tools"] },
        { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash · Ozlon", cap: ["text", "tools"] },
        { id: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image · Ozlon", cap: ["image"] },
        { id: "google/veo-3-fast", label: "Veo 3 Fast · Ozlon", cap: ["video"] },
      );
    }
    if (isPlatformConnected(PLATFORMS[1])) {
      list.push(
        { id: "openai/gpt-5", label: "GPT-5 · Ozlon", cap: ["text", "tools"] },
        { id: "openai/gpt-5-mini", label: "GPT-5 Mini · Ozlon", cap: ["text", "tools"] },
      );
    }
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
    const label = (labelInputs[p.id] || "").trim();
    if (key.length < 8) {
      toast.error("That key looks too short");
      return;
    }
    setBusyId(p.id);
    try {
      const { data, error } = await supabase.functions.invoke("connect-brain", {
        body: { action: "connect", platform_id: p.id, api_key: key, label: label || undefined },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Couldn't plug it in");
      toast.success(`${p.label} is now part of your gauntlet`);
      setKeyInputs((s) => ({ ...s, [p.id]: "" }));
      setLabelInputs((s) => ({ ...s, [p.id]: "" }));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDisconnect = async () => {
    const p = pendingRemove;
    if (!p || p.source !== "byok") { setPendingRemove(null); return; }
    setBusyId(p.id);
    try {
      const { data, error } = await supabase.functions.invoke("connect-brain", {
        body: { action: "disconnect", platform_id: p.id },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Couldn't remove");
      toast.success(`${p.label} removed from the gauntlet`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusyId(null);
      setPendingRemove(null);
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
            <p className="text-xs text-muted-foreground">One mind. Many lobes. Auto-tuned to the moment.</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 space-y-10 pt-6">
        {/* AI Gauntlet — Auto router with hot-swappable Brain Stones */}
        <section>
          <GauntletPanel />
        </section>

        {/* Empty-state hero */}
        {!userHasPersonalBrain && (
          <div className="rounded-2xl bg-primary/5 border border-primary/20 p-5">
            <p className="text-sm font-medium text-foreground">
              Ozlon runs on multiple AI brains.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Add your own to unlock more — faster, cheaper, and tuned to you.
            </p>
          </div>
        )}

        {/* ============ Your Brains ============ */}
        <section>
          <div className="px-1 mb-3">
            <h2 className="text-sm font-semibold text-foreground">Your Brains</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              The minds active right now. Each one powers everything its skills cover.
            </p>
          </div>
          <div className="space-y-2">
            {connected.map((p) => {
              const nickname = platformNickname(p);
              const Glyph = p.Glyph;
              return (
                <div key={p.id} className="p-4 rounded-2xl bg-card/60 border border-border/30">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Glyph className="w-5 h-5 text-primary" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm text-foreground">
                          {nickname || p.label}
                        </p>
                        {nickname && (
                          <span className="text-[10px] text-muted-foreground">({p.label})</span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          <Check className="w-2.5 h-2.5" /> Active
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Powering: <span className="text-foreground/80">{p.capabilities.map(humanizeCap).join(" · ")}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground/70 mt-1">{platformKeyTail(p)}</p>

                      <div className="flex items-center gap-3 mt-3">
                        {p.console_url && p.source === "byok" && (
                          <a
                            href={p.console_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Manage at console <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {p.manageRoute && (
                          <button
                            onClick={() => navigate(p.manageRoute!)}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Manage <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                        {p.source === "byok" && (
                          <button
                            onClick={() => setPendingRemove(p)}
                            disabled={busyId === p.id}
                            className="ml-auto text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                          >
                            {busyId === p.id ? "Removing…" : "Remove from Gauntlet"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ============ Add another Brain ============ */}
        {notConnected.length > 0 && (
          <section>
            <div className="px-1 mb-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add another Brain
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bring your own keys to unlock more power.
              </p>
            </div>
            <div className="space-y-2">
              {notConnected.map((p) => {
                const Glyph = p.Glyph;
                const inputVal = keyInputs[p.id] || "";
                const validation = validateKey(inputVal, p.key_prefix);
                return (
                  <div key={p.id} className="p-4 rounded-2xl bg-card/40 border border-dashed border-border/40">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center shrink-0">
                        <Glyph className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm text-foreground">{p.label}</p>
                          {p.recommended && (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                              <Star className="w-2.5 h-2.5" /> Recommended first
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{p.human_blurb}</p>
                        <p className="text-[11px] text-muted-foreground/70 mt-1.5">
                          Skills: {p.capabilities.map(humanizeCap).join(" · ")}
                        </p>
                      </div>
                    </div>

                    {p.source === "byok" && (
                      <div className="space-y-2">
                        {p.console_url && (
                          <a
                            href={p.console_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Some providers offer free tiers (Gemini), others charge per-token after signup."
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
                          >
                            Where to get a key <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <div className="relative">
                          <Input
                            type="password"
                            placeholder={p.key_prefix ? `${p.key_prefix}…` : "Paste your API key"}
                            value={inputVal}
                            onChange={(e) => setKeyInputs((s) => ({ ...s, [p.id]: e.target.value }))}
                            className={cn(
                              "h-10 text-sm font-mono pr-10",
                              validation === "ok" && "border-emerald-500/40",
                              validation === "warn" && "border-amber-500/40",
                            )}
                          />
                          {validation === "ok" && (
                            <Check className="w-4 h-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2" />
                          )}
                          {validation === "warn" && (
                            <AlertCircle className="w-4 h-4 text-amber-500 absolute right-3 top-1/2 -translate-y-1/2" />
                          )}
                        </div>
                        {validation === "warn" && p.key_prefix && (
                          <p className="text-[11px] text-amber-500">
                            Doesn't look like a {p.label} key (usually starts with <span className="font-mono">{p.key_prefix}</span>) — double-check?
                          </p>
                        )}
                        <Input
                          type="text"
                          placeholder="Nickname this brain (optional, e.g. Personal, Work)"
                          value={labelInputs[p.id] || ""}
                          onChange={(e) => setLabelInputs((s) => ({ ...s, [p.id]: e.target.value }))}
                          className="h-9 text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          We store this securely. Only you can see it.
                        </p>
                        <Button
                          onClick={() => handleConnect(p)}
                          disabled={busyId === p.id || inputVal.trim().length < 8}
                          className="w-full h-10"
                        >
                          {busyId === p.id ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Plugging in…</>
                          ) : (
                            "Plug it in"
                          )}
                        </Button>
                      </div>
                    )}

                    {p.source === "edge" && p.manageRoute && (
                      <Button variant="outline" className="w-full h-10" onClick={() => navigate(p.manageRoute!)}>
                        Set up {p.label}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ============ How your Brains work together ============ */}
        <section>
          <div className="px-1 mb-3">
            <h2 className="text-sm font-semibold text-foreground">How your Brains work together</h2>
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

        {/* ============ This week's activity ============ */}
        {logs.length > 0 && (
          <section>
            <div className="px-1 mb-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> This week's activity
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Recent reliability and speed by job.</p>
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

      {/* Confirm remove dialog */}
      <AlertDialog open={!!pendingRemove} onOpenChange={(open) => !open && setPendingRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingRemove?.label} from the Gauntlet?</AlertDialogTitle>
            <AlertDialogDescription>
              This brain will stop powering Ozlon. You can plug it back in anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

const HUMAN_CAP: Record<string, string> = {
  text: "Conversation",
  tools: "Actions",
  image: "Images",
  video: "Video",
  voice: "Voice",
};

function humanizeCap(c: string): string {
  return HUMAN_CAP[c] || c;
}

function normalizeCap(c: string): Capability | "" {
  if (c === "tools") return "tools";
  if (c === "image_gen") return "image";
  if (c === "video_gen") return "video";
  if (c === "vision" || c === "json" || c === "long_context" || c === "reasoning") return "text";
  return "";
}

function validateKey(value: string, prefix?: string): "empty" | "ok" | "warn" {
  const v = value.trim();
  if (v.length < 4) return "empty";
  if (!prefix) return v.length >= 8 ? "ok" : "empty";
  return v.startsWith(prefix) ? "ok" : "warn";
}

export default ModelRouting;
