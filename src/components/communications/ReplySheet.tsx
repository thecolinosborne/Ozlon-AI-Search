import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Send, Sparkles, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { channelIcon, channelTint, formatTime } from "./channelStyle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { CommMessage } from "@/hooks/useCommunicationsFeed";

interface ThreadMessage {
  id: string;
  fromName: string;
  fromHandle?: string;
  direction: "in" | "out";
  body: string;
  sentAt: string;
}

interface ReplySheetProps {
  message: CommMessage | null;
  onClose: () => void;
  onDeleted?: (m: CommMessage) => void;
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

function threadIdFor(m: CommMessage): string {
  // Gmail/GHL: use threadId. Slack: extract channel from id "slack:<channel>:<ts>".
  if (m.source === "slack") {
    const parts = m.id.split(":");
    return parts[1] || m.threadId || "";
  }
  return m.threadId || "";
}

export function ReplySheet({ message, onClose, onDeleted }: ReplySheetProps) {
  const [draft, setDraft] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const threadQ = useQuery({
    queryKey: ["comm-thread", message?.id],
    enabled: !!message,
    staleTime: 60_000,
    queryFn: async (): Promise<ThreadMessage[]> => {
      if (!message) return [];
      const { data, error } = await supabase.functions.invoke("communications-thread", {
        body: {
          source: message.source,
          threadId: threadIdFor(message),
          messageId: message.id,
        },
      });
      if (error) throw error;
      return (data as { messages?: ThreadMessage[] })?.messages ?? [];
    },
  });

  async function generate(m: CommMessage, tone: Tone = "default") {
    setIsDrafting(true);
    try {
      const ctx = (threadQ.data ?? []).slice(-3).map((t) => ({
        from: t.fromName,
        body: t.body,
        direction: t.direction,
      }));
      const { data, error } = await supabase.functions.invoke("communications-draft", {
        body: {
          channel: m.channel,
          fromName: m.fromName,
          channelLabel: m.channelLabel,
          subject: m.subject,
          preview: m.preview,
          tone,
          threadContext: ctx,
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

  // Reset on message change
  useEffect(() => {
    if (!message) return;
    setDraft("");
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);

  // Generate draft once thread has loaded (or failed) so AI gets context
  useEffect(() => {
    if (!message) return;
    if (threadQ.isLoading) return;
    if (draft) return;
    generate(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id, threadQ.isLoading]);

  // Auto-scroll to newest bubble
  useEffect(() => {
    if (threadQ.data?.length) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [threadQ.data?.length]);

  async function handleDelete() {
    if (!message) return;
    setIsDeleting(true);
    try {
      if (message.source === "gmail") {
        const id = message.id.replace(/^gmail:/, "");
        const { error } = await supabase.functions.invoke("google-gmail", {
          body: { action: "trash_message", params: { id } },
        });
        if (error) throw error;
        toast({
          title: "Moved to trash",
          description: "Email moved to Gmail Trash.",
          action: (
            <button
              onClick={async () => {
                await supabase.functions.invoke("google-gmail", {
                  body: { action: "untrash_message", params: { id } },
                });
                toast({ title: "Restored" });
              }}
              className="text-xs font-medium text-primary hover:underline"
            >
              Undo
            </button>
          ),
        });
        onDeleted?.(message);
        onClose();
      } else if (message.source === "slack") {
        const parts = message.id.split(":");
        const channel = parts[1];
        const ts = parts.slice(2).join(":");
        const { data, error } = await supabase.functions.invoke("slack", {
          body: { action: "delete_message", params: { channel, ts } },
        });
        const ok = !error && (data as { ok?: boolean })?.ok !== false;
        if (!ok) {
          toast({
            title: "Can't delete",
            description: "Slack only allows deleting messages you posted.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Deleted from Slack" });
          onDeleted?.(message);
          onClose();
        }
      } else if (message.source === "ghl") {
        const conversationId = message.threadId || message.id.replace(/^ghl:/, "");
        const { error } = await supabase.functions.invoke("gohighlevel", {
          body: {
            action: "update_conversation",
            params: { conversationId, read: true },
          },
        });
        if (error) {
          toast({ title: "Couldn't mark as read", variant: "destructive" });
        } else {
          toast({ title: "Marked as read" });
          onDeleted?.(message);
          onClose();
        }
      }
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (!message) return null;
  const Icon = channelIcon(message.channel);
  const tint = channelTint(message.channel);
  const sendLabel = `Send via ${message.channelLabel}`;
  const threadMsgs = threadQ.data ?? [];
  const showFallback = !threadQ.isLoading && threadMsgs.length === 0;

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

        {/* Thread + composer */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {message.subject && (
            <h3 className="text-base font-semibold text-foreground mb-3">{message.subject}</h3>
          )}

          {/* Thread bubbles */}
          <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-1">
            {threadQ.isLoading ? (
              <>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-14 rounded-2xl bg-background/40 animate-pulse",
                      i % 2 === 0 ? "max-w-[85%]" : "max-w-[70%] ml-auto",
                    )}
                  />
                ))}
              </>
            ) : showFallback ? (
              <div className="rounded-2xl bg-background/40 border border-border/20 p-4">
                <p className="text-[14px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                  {message.preview}
                </p>
              </div>
            ) : (
              threadMsgs.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "flex flex-col gap-0.5",
                    t.direction === "out" ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words",
                      t.direction === "out"
                        ? "bg-primary/15 text-foreground border border-primary/20"
                        : "bg-background/60 text-foreground/90 border border-border/20",
                    )}
                  >
                    {t.body}
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 px-1">
                    {t.direction === "out" ? "You" : t.fromName.split(/[<·@]/)[0].trim()} ·{" "}
                    {formatTime(new Date(t.sentAt))}
                  </span>
                </div>
              ))
            )}
            <div ref={threadEndRef} />
          </div>

          {/* AI draft block */}
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
            className="w-10 h-10 rounded-full bg-card/70 border border-border/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Voice reply"
          >
            <Mic className="w-4 h-4" />
          </button>

          {/* Delete / archive */}
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 h-10 px-1 rounded-full bg-destructive/10 border border-destructive/30">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="h-8 px-3 rounded-full bg-destructive text-destructive-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-60"
              >
                {isDeleting && <Loader2 className="w-3 h-3 animate-spin" />}
                {message.source === "ghl" ? "Mark read" : "Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={isDeleting}
                className="h-8 px-2.5 rounded-full text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-10 h-10 rounded-full bg-card/70 border border-border/30 flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
              aria-label={message.source === "ghl" ? "Mark as read" : "Delete message"}
              title={message.source === "ghl" ? "Mark as read" : "Delete message"}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

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
