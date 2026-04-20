import { useState } from "react";
import { CheckCircle2, XCircle, Loader2, Circle, ExternalLink, Pencil, Trash2, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ProviderRow, StoneCapability, UserKeyStatus } from "@/hooks/useGauntlet";

const PROVIDER_META: Record<string, { label: string; consoleUrl: string; keyPrefix: string; blurb: string }> = {
  lovable:    { label: "Lovable Gateway", consoleUrl: "", keyPrefix: "", blurb: "Built-in. Always on." },
  openai:     { label: "OpenAI",          consoleUrl: "https://platform.openai.com/api-keys", keyPrefix: "sk-", blurb: "GPT-5 family." },
  gemini:     { label: "Gemini",          consoleUrl: "https://aistudio.google.com/apikey", keyPrefix: "AIza", blurb: "Google's multimodal." },
  higgsfield: { label: "Higgsfield AI",   consoleUrl: "https://higgsfield.ai", keyPrefix: "", blurb: "Cinematic video & image." },
  anthropic:  { label: "Claude",          consoleUrl: "https://console.anthropic.com/settings/keys", keyPrefix: "sk-ant-", blurb: "Anthropic. Long-form thinking." },
  xai:        { label: "Grok",            consoleUrl: "https://console.x.ai", keyPrefix: "xai-", blurb: "xAI. Witty, real-time." },
  deepseek:   { label: "DeepSeek",        consoleUrl: "https://platform.deepseek.com/api_keys", keyPrefix: "sk-", blurb: "Budget-friendly reasoning." },
  mistral:    { label: "Mistral",         consoleUrl: "https://console.mistral.ai/api-keys", keyPrefix: "", blurb: "European, privacy-minded." },
};

interface Props {
  provider: string;
  row?: ProviderRow;          // gauntlet-router state (only for SYSTEM-verified providers)
  capability?: StoneCapability;
  userKey?: UserKeyStatus;    // connect-brain state (personal key)
  systemAvailable: boolean;   // does the project have an env secret for this provider
  verifying: boolean;
  onChanged: () => void;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const StoneSlot = ({ provider, row, capability, userKey, systemAvailable, verifying, onChanged }: Props) => {
  const meta = PROVIDER_META[provider] ?? { label: provider, consoleUrl: "", keyPrefix: "", blurb: "" };
  const [editing, setEditing] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);

  const isLovable = provider === "lovable";
  const hasUserKey = !!userKey?.connected;
  // System-verified state comes from ai_providers row (only present for system stones the gauntlet tracks)
  const systemActive = row?.status === "active" && (row?.capabilities as any)?.source === "system";
  const isError = row?.status === "error" && systemAvailable && !hasUserKey;

  // Derived display state
  const state: "personal" | "system" | "error" | "available" = hasUserKey
    ? "personal"
    : systemActive
    ? "system"
    : isError
    ? "error"
    : "available";

  const handleConnect = async () => {
    const trimmed = keyInput.trim();
    if (trimmed.length < 8) {
      toast.error("That key looks too short");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("connect-brain", {
        body: { action: "connect", platform_id: provider, api_key: trimmed },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Couldn't save");
      toast.success(`${meta.label} connected`);
      setKeyInput("");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("connect-brain", {
        body: { action: "disconnect", platform_id: provider },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Couldn't remove");
      toast.success(systemAvailable ? `${meta.label} reverted to system key` : `${meta.label} removed`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusy(false);
    }
  };

  // ─── Lovable: read-only platform default ───
  if (isLovable) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-border/40 bg-card/60">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn("w-2 h-2 rounded-full shrink-0", systemActive ? "bg-primary animate-pulse" : "bg-muted-foreground/40")} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{meta.label}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              Platform default · always on
            </div>
          </div>
        </div>
        <div className="shrink-0">
          {verifying ? (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          ) : systemActive ? (
            <CheckCircle2 className="w-4 h-4 text-primary" />
          ) : null}
        </div>
      </div>
    );
  }

  // ─── Editing form (open input) ───
  if (editing) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/30">
          <div className="text-sm font-medium text-foreground">
            {hasUserKey ? `Replace ${meta.label} key` : `Add ${meta.label} key`}
          </div>
          <button
            onClick={() => { setEditing(false); setKeyInput(""); }}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {meta.consoleUrl && (
            <a
              href={meta.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80"
            >
              Get a key <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <Input
            type="password"
            placeholder={meta.keyPrefix ? `${meta.keyPrefix}…` : "Paste your API key"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            className="h-9 text-xs font-mono"
          />
          <Button
            onClick={handleConnect}
            disabled={busy || keyInput.trim().length < 8}
            size="sm"
            className="w-full h-9"
          >
            {busy ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Saving…</>
            ) : (
              <><Check className="w-3.5 h-3.5 mr-1.5" /> Save & verify</>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Display row (personal / system / error / available) ───
  const dotClass =
    state === "personal" ? "bg-primary animate-pulse"
    : state === "system" ? "bg-primary animate-pulse"
    : state === "error"  ? "bg-destructive"
    : "bg-muted-foreground/40";

  const subline = (() => {
    if (state === "personal") {
      return <>••••{userKey?.last4} · your key</>;
    }
    if (state === "system") {
      return (
        <>
          {capability?.keyTail && <>••••{capability.keyTail} · system key</>}
          {!capability?.keyTail && "system key"}
          {row?.last_verified_at && <> · verified {formatRelative(row.last_verified_at)}</>}
        </>
      );
    }
    if (state === "error") {
      return <span className="text-destructive/80">key invalid — replace below</span>;
    }
    return systemAvailable ? "Available · using system key, override below" : "Add a key to enable";
  })();

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all",
        state === "available" ? "border-dashed border-border/30 bg-transparent" : "border-border/40 bg-card/60",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {state === "available" ? (
          <Circle className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" strokeWidth={1.5} />
        ) : (
          <span className={cn("w-2 h-2 rounded-full shrink-0", dotClass)} />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{meta.label}</div>
          <div className="text-[11px] text-muted-foreground truncate">{subline}</div>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1">
        {verifying && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
        {!verifying && state === "system" && <CheckCircle2 className="w-4 h-4 text-primary" />}
        {!verifying && state === "personal" && <CheckCircle2 className="w-4 h-4 text-primary" />}
        {!verifying && state === "error" && <XCircle className="w-4 h-4 text-destructive" />}

        {/* Edit/replace button: always available except while verifying */}
        {!verifying && (
          <button
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label={hasUserKey ? "Replace key" : "Add key"}
            title={hasUserKey ? "Replace your key" : (state === "system" ? "Override with your key" : "Add key")}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Remove personal key */}
        {!verifying && hasUserKey && (
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="text-muted-foreground hover:text-destructive transition-colors p-1"
            aria-label="Remove personal key"
            title={systemAvailable ? "Remove your key (use system key)" : "Remove your key"}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
};
