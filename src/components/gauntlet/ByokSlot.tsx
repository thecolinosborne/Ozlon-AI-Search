import { useState } from "react";
import { Loader2, Check, ExternalLink, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ByokPlatform {
  id: string;
  label: string;
  blurb: string;
  console_url: string;
  key_prefix: string;
}

interface Props {
  platform: ByokPlatform;
  connected: boolean;
  last4?: string;
  nickname?: string | null;
  onChanged: () => void;
}

export const ByokSlot = ({ platform, connected, last4, nickname, onChanged }: Props) => {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const handleConnect = async () => {
    const trimmed = key.trim();
    if (trimmed.length < 8) {
      toast.error("That key looks too short");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("connect-brain", {
        body: { action: "connect", platform_id: platform.id, api_key: trimmed },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Couldn't plug it in");
      toast.success(`${platform.label} connected`);
      setKey("");
      setOpen(false);
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
        body: { action: "disconnect", platform_id: platform.id },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Couldn't remove");
      toast.success(`${platform.label} removed`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusy(false);
    }
  };

  if (connected) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-border/40 bg-card/60">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">
              {nickname || platform.label}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              ••••{last4} · your key
            </div>
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={busy}
          className="text-muted-foreground hover:text-destructive transition-colors p-1"
          aria-label="Disconnect"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-border/30 bg-transparent overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-card/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
          <div className="min-w-0 text-left">
            <div className="text-sm font-medium text-foreground truncate">{platform.label}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {open ? "Paste your API key below" : "Click to add your key"}
            </div>
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {open ? "Cancel" : "Add key"}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-border/30 pt-3">
          <a
            href={platform.console_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80"
          >
            Get a key <ExternalLink className="w-3 h-3" />
          </a>
          <Input
            type="password"
            placeholder={platform.key_prefix ? `${platform.key_prefix}…` : "Paste your API key"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={cn("h-9 text-xs font-mono")}
          />
          <Button
            onClick={handleConnect}
            disabled={busy || key.trim().length < 8}
            size="sm"
            className="w-full h-9"
          >
            {busy ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Connecting…</>
            ) : (
              <><Check className="w-3.5 h-3.5 mr-1.5" /> Plug it in</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
