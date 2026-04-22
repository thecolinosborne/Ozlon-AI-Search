import { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Send, Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { channelIcon, channelTint, formatTime } from "./channelStyle";
import { supabase } from "@/integrations/supabase/client";
import type { CommMessage } from "@/hooks/useCommunicationsFeed";

interface ReplySheetProps {
  message: CommMessage | null;
  onClose: () => void;
}

type Tone = "default" | "shorter" | "friendlier" | "firmer";

function fallbackDraft(m: CommMessage): string {
  const first = m.fromName.split(" ")[0] || "there";
  switch (m.channel) {
    case "email":
      return `Hi ${first},\n\nThanks for the note — got it and I'll get back to you shortly.\n\nBest,`;
    case "slack":
      return `thanks — taking a look and will follow up in thread.`;
    case "sms":
      return `Got it — will get back to you shortly.`;
    case "voicemail":
      return `Hey ${first}, got your voicemail — calling you back shortly.`;
  }
}

export function ReplySheet({ message, onClose }: ReplySheetProps) {
  const [draft, setDraft] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);

  async function generate(m: CommMessage, tone: Tone = "default") {
    setIsDrafting(true);
    try {
      const { data, error } = await supabase.functions.invoke("communications-draft", {
        body: {
          channel: m.channel,
          fromName: m.fromName,
          channelLabel: m.channelLabel,
          subject: m.subject,
          preview: m.preview,
          tone,
        },
      });
      if (error) throw error;
      const next = (data as { draft?: string })?.draft;
      setDraft(next && next.trim().length > 0 ? next : fallbackDraft(m));
    } catch {
      setDraft(fallbackDraft(m));
    } finally {
      setIsDrafting(false);
    }
  }

  useEffect(() => {
    if (!message) return;
    setDraft("");
    generate(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);

  if (!message) return null;
  const Icon = channelIcon(message.channel);
  const tint = channelTint(message.channel);
  const sendLabel = `Send via ${message.channelLabel}`;

  return (
    <Sheet open={!!message} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[88vh] rounded-t-3xl bg-card/80 backdrop-blur-2xl border-border/30 p-0 flex flex-col"
      >
        {/* Drag handle */}
        <div className="pt-3 pb-2 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-foreground/15" />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 border-b border-border/20">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-background/60 border border-border/30 flex items-center justify-center">
                <Icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <span
                className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-card"
                style={{ background: tint }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-foreground truncate">
                {message.fromName}
              </p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
                {message.channelLabel} · {formatTime(message.receivedAt)}
              </p>
            </div>
          </div>
        </div>

        {/* Thread context */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {message.subject && (
            <h3 className="text-base font-semibold text-foreground mb-2">{message.subject}</h3>
          )}
          <div className="rounded-2xl bg-background/40 border border-border/20 p-4 max-h-[40vh] overflow-y-auto">
            <p className="text-[14px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
              {message.preview}
            </p>
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary/80">
              <Sparkles className={cn("w-3 h-3", isDrafting && "animate-pulse")} />
              <span>{isDrafting ? "Drafting…" : "AI draft ready"}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => generate(message, "shorter")}
                disabled={isDrafting}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors disabled:opacity-50"
              >
                Shorter
              </button>
              <button
                onClick={() => generate(message, "friendlier")}
                disabled={isDrafting}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors disabled:opacity-50"
              >
                Friendlier
              </button>
              <button
                onClick={() => generate(message, "firmer")}
                disabled={isDrafting}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors disabled:opacity-50"
              >
                Firmer
              </button>
              <button
                onClick={() => generate(message, "default")}
                disabled={isDrafting}
                className="ml-1 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors disabled:opacity-50"
                aria-label="Regenerate"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isDrafting && "animate-spin")} />
              </button>
            </div>
          </div>
          <div className="mt-2 rounded-2xl bg-card/60 border border-border/30 backdrop-blur-xl p-1">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={cn(
                "min-h-[140px] border-0 bg-transparent resize-none focus-visible:ring-0 text-[14px] leading-relaxed transition-opacity",
                isDrafting && draft.length === 0 && "opacity-50",
              )}
              placeholder={isDrafting ? "Drafting your reply…" : "Reply…"}
            />
          </div>
        </div>

        {/* Footer composer actions */}
        <div className="px-5 py-3 border-t border-border/20 flex items-center gap-2 bg-background/40 backdrop-blur-xl safe-area-bottom">
          <button
            className={cn(
              "w-10 h-10 rounded-full bg-card/70 border border-border/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors",
            )}
            aria-label="Voice reply"
          >
            <Mic className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-[var(--button-glow)] hover:opacity-90 active:scale-[0.99] transition-all"
          >
            <Send className="w-4 h-4" />
            <span>{sendLabel}</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
