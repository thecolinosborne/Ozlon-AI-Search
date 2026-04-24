import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Send, Sparkles, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { channelIcon, channelTint, formatTime } from "./channelStyle";
import { RichEmailEditor } from "./RichEmailEditor";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Linkify } from "@/lib/linkify";
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
  initialDraft?: string;
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

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function threadIdFor(m: CommMessage): string {
  if (m.source === "slack") {
    const parts = m.id.split(":");
    return parts[1] || m.threadId || "";
  }
  return m.threadId || "";
}

function slackChannelFor(m: CommMessage): { channel: string; ts?: string } {
  const parts = m.id.split(":");
  return { channel: parts[1] || "", ts: parts.slice(2).join(":") || undefined };
}

export function ReplySheet({ message, onClose, onDeleted, initialDraft }: ReplySheetProps) {
  const [draftText, setDraftText] = useState("");
  const [draftHtml, setDraftHtml] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const isEmail = message?.channel === "email";

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
      const txt = next && next.trim().length > 0 ? next : fallbackDraft(m);
      setDraftText(txt);
      setDraftHtml(textToHtml(txt));
    } catch {
      const txt = fallbackDraft(m);
      setDraftText(txt);
      setDraftHtml(textToHtml(txt));
    } finally {
      setIsDrafting(false);
    }
  }

  useEffect(() => {
    if (!message) return;
    if (initialDraft) {
      setDraftText(initialDraft);
      setDraftHtml(textToHtml(initialDraft));
    } else {
      setDraftText("");
      setDraftHtml("");
    }
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);

  useEffect(() => {
    if (!message) return;
    if (threadQ.isLoading) return;
    if (draftText) return;
    generate(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id, threadQ.isLoading]);

  useEffect(() => {
    if (threadQ.data?.length) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [threadQ.data?.length]);

  async function handleSend() {
    if (!message) return;
    const text = draftText.trim();
    if (!text) {
      toast({ title: "Nothing to send", description: "Write a reply first.", variant: "destructive" });
      return;
    }
    setIsSending(true);
    try {
      const lastInbound = (threadQ.data ?? []).filter((t) => t.direction === "in").slice(-1)[0];
      const quoted = isEmail && lastInbound
        ? { from: lastInbound.fromName, date: lastInbound.sentAt, text: lastInbound.body }
        : undefined;

      const body: Record<string, unknown> = {
        channel: message.channel,
        source: message.source,
        bodyText: text,
        bodyHtml: isEmail ? draftHtml : undefined,
        quoted,
      };

      if (message.source === "gmail") {
        body.to = message.fromHandle ?? "";
        body.subject = message.subject?.startsWith("Re:") ? message.subject : `Re: ${message.subject ?? ""}`;
        body.threadId = message.threadId;
        body.inReplyTo = message.id.replace(/^gmail:/, "");
      } else if (message.source === "slack") {
        const { channel, ts } = slackChannelFor(message);
        body.channelId = channel;
        body.threadTs = ts;
      } else if (message.source === "ghl") {
        body.conversationId = message.threadId || message.id.replace(/^ghl:/, "");
      }

      // Explicitly forward the session JWT — supabase-js doesn't always attach
      // it on functions.invoke, which silently 401s. See: comms-send edge logs.
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      console.info("[reply] sending via", message.source, { hasJwt: !!session?.access_token });

      const { data, error } = await supabase.functions.invoke("communications-send", {
        body,
        headers,
      });
      if (error) throw error;
      const ok = (data as { ok?: boolean })?.ok !== false;
      if (!ok) throw new Error((data as { error?: string })?.error || "Send failed");

      toast({ title: `Sent via ${message.channelLabel}` });
      onClose();
    } catch (e) {
      console.error("[reply] send failed:", e);
      toast({
        title: "Send failed",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  }

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
        const { channel, ts } = slackChannelFor(message);
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
          body: { action: "update_conversation", params: { conversationId, read: true } },
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
        <div className="pt-3 pb-2 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-foreground/15" />
        </div>

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
              <p className="text-[15px] font-medium text-foreground truncate">{message.fromName}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
                {message.channelLabel} · {formatTime(message.receivedAt)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {message.subject && (
            <h3 className="text-base font-semibold text-foreground mb-3">{message.subject}</h3>
          )}

          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
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
                  <Linkify text={message.preview} />
                </p>
              </div>
            ) : (
              threadMsgs.map((t) => (
                <ThreadBubble key={t.id} t={t} />
              ))
            )}
            <div ref={threadEndRef} />
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary/80">
              <Sparkles className={cn("w-3 h-3", isDrafting && "animate-pulse")} />
              <span>{isDrafting ? "Drafting…" : "AI draft ready"}</span>
            </div>
            <div className="flex items-center gap-1">
              {(["shorter", "friendlier", "firmer"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => generate(message, t)}
                  disabled={isDrafting}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors disabled:opacity-50 capitalize"
                >
                  {t}
                </button>
              ))}
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

          {/* Channel-aware composer */}
          <div className="mt-2">
            {isEmail ? (
              <RichEmailEditor
                value={draftHtml}
                disabled={isDrafting || isSending}
                placeholder={isDrafting ? "Drafting your reply…" : "Reply…"}
                onChange={(html, text) => {
                  setDraftHtml(html);
                  setDraftText(text);
                }}
              />
            ) : (
              <div className="rounded-2xl bg-card/60 border border-border/30 backdrop-blur-xl p-1">
                <Textarea
                  value={draftText}
                  onChange={(e) => {
                    setDraftText(e.target.value);
                    setDraftHtml(textToHtml(e.target.value));
                  }}
                  className={cn(
                    "min-h-[100px] border-0 bg-transparent resize-none focus-visible:ring-0 text-[14px] leading-relaxed transition-opacity",
                    isDrafting && draftText.length === 0 && "opacity-50",
                  )}
                  placeholder={isDrafting ? "Drafting your reply…" : "Reply…"}
                />
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border/20 flex items-center gap-2 bg-background/40 backdrop-blur-xl safe-area-bottom">
          <button
            className="w-10 h-10 rounded-full bg-card/70 border border-border/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Voice reply"
          >
            <Mic className="w-4 h-4" />
          </button>

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
            onClick={handleSend}
            disabled={isSending || isDrafting}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-[var(--button-glow)] hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-60"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span>{isSending ? "Sending…" : sendLabel}</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
