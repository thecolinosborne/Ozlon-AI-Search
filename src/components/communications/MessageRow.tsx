import { Check, Clock, Trash2, Reply, CalendarPlus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { channelIcon, channelTint, formatTime } from "./channelStyle";
import { VoicemailInline } from "./VoicemailInline";
import { Linkify } from "@/lib/linkify";
import { useSwipeActions } from "@/hooks/useSwipeActions";
import type { CommMessage, TriageItem } from "@/hooks/useCommunicationsFeed";

interface MessageRowProps {
  message: CommMessage;
  triage?: TriageItem;
  onTap: (m: CommMessage) => void;
  onDone?: (m: CommMessage) => void;
  onSnooze?: (m: CommMessage) => void;
  onDelete?: (m: CommMessage) => void;
  isFocused?: boolean;
}

function urgencyBarTone(urgency?: TriageItem["urgency"]): string {
  switch (urgency) {
    case "high":
      return "bg-amber-500";
    case "medium":
      return "bg-primary/70";
    case "low":
      return "bg-muted-foreground/30";
    default:
      return "bg-transparent";
  }
}

function actionLabel(hint?: TriageItem["actionHint"]): { label: string; Icon: typeof Reply } | null {
  switch (hint) {
    case "reply":
      return { label: "Reply", Icon: Reply };
    case "schedule":
      return { label: "Schedule", Icon: CalendarPlus };
    case "snooze":
      return { label: "Later", Icon: Clock };
    case "done":
      return { label: "Done", Icon: Check };
    default:
      return null;
  }
}

export function MessageRow({
  message,
  triage,
  onTap,
  onDone,
  onSnooze,
  onDelete,
  isFocused,
}: MessageRowProps) {
  const Icon = channelIcon(message.channel);
  const tint = channelTint(message.channel);
  const urgencyTone = urgencyBarTone(triage?.urgency);
  const primaryAction = actionLabel(triage?.actionHint);

  // Swipe right → Done, Swipe left → Snooze (mobile triage gestures).
  const swipe = useSwipeActions({
    onSwipeRight: onDone ? () => onDone(message) : undefined,
    onSwipeLeft: onSnooze ? () => onSnooze(message) : undefined,
    threshold: 80,
  });

  const showRightAction = swipe.offset > 12 && !!onDone;
  const showLeftAction = swipe.offset < -12 && !!onSnooze;

  return (
    <div className="relative overflow-hidden">
      {/* Swipe action backdrops (mobile) */}
      {showRightAction && (
        <div className="absolute inset-y-0 left-0 flex items-center px-5 bg-primary/15 text-primary text-[12px] font-medium gap-1.5 lg:hidden">
          <Check className="w-4 h-4" />
          Done
        </div>
      )}
      {showLeftAction && (
        <div className="absolute inset-y-0 right-0 flex items-center px-5 bg-amber-500/15 text-amber-300 text-[12px] font-medium gap-1.5 lg:hidden">
          <Clock className="w-4 h-4" />
          Later
        </div>
      )}

      <div
        onClick={() => {
          if (Math.abs(swipe.offset) < 4) onTap(message);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTap(message);
          }
        }}
        {...swipe.handlers}
        style={{ transform: `translateX(${swipe.offset}px)` }}
        data-message-id={message.id}
        className={cn(
          "group relative w-full text-left flex items-start gap-3 px-4 lg:px-6 py-3.5 cursor-pointer bg-background",
          "hover:bg-card/30 active:bg-card/50 transition-colors",
          "focus-visible:outline-none focus-visible:bg-card/30",
          isFocused && "bg-card/40 ring-1 ring-inset ring-primary/30",
          !swipe.isSwiping && "transition-transform duration-200",
        )}
      >
      {/* Urgency rail (3px) — silent if no triage */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full transition-opacity",
          urgencyTone,
          triage?.urgency ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Avatar / channel glyph */}
      <div className="relative shrink-0">
        <div className="w-8 h-8 rounded-full bg-card/60 backdrop-blur-xl border border-border/30 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-background"
          style={{ background: tint }}
          aria-hidden
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-medium text-foreground truncate">
            {message.fromName}
            {message.groupCount && message.groupCount > 1 ? (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {message.groupCount} messages
              </span>
            ) : null}
          </span>
          <span className="text-[12px] tabular-nums text-muted-foreground/80 shrink-0">
            {formatTime(message.receivedAt)}
          </span>
        </div>

        {message.subject && (
          <p className="text-[14px] text-foreground/90 line-clamp-2 mt-0.5 leading-snug">
            {message.subject}
          </p>
        )}

        {message.audioUrl !== undefined || message.channel === "voicemail" ? (
          <div className="mt-1.5">
            <VoicemailInline durationSec={message.durationSec ?? 0} />
            <p className="mt-1.5 text-[13px] text-muted-foreground line-clamp-2 leading-snug">
              <Linkify text={message.preview} />
            </p>
          </div>
        ) : (
          <p className="text-[13.5px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
            <Linkify text={message.preview} />
          </p>
        )}

        {/* AI reasoning line — appears only when triage present */}
        {triage?.reason && (
          <p className="mt-1 text-[11.5px] text-primary/80 line-clamp-1 leading-snug flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{triage.reason}</span>
          </p>
        )}

        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {message.channelLabel}
          </span>
          {message.needsReply && !triage?.actionHint && (
            <span className="text-[10px] uppercase tracking-wider text-primary/80">
              · Needs reply
            </span>
          )}
          {triage?.urgency === "high" && (
            <span className="text-[10px] uppercase tracking-wider text-amber-300/90">
              · Urgent
            </span>
          )}
        </div>
      </div>

      {/* Unread dot */}
      {message.isUnread && (
        <span
          className="mt-2 w-1.5 h-1.5 rounded-full bg-primary shrink-0"
          aria-label="Unread"
        />
      )}

      {/* Hover actions (desktop) */}
      {(onDone || onSnooze || onDelete || primaryAction) && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {primaryAction && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTap(message);
              }}
              className="h-7 px-2.5 rounded-full bg-primary/15 text-primary border border-primary/30 text-[11px] font-medium hover:bg-primary/25 flex items-center gap-1"
              aria-label={primaryAction.label}
            >
              <primaryAction.Icon className="w-3 h-3" />
              {primaryAction.label}
            </button>
          )}
          {onSnooze && !primaryAction && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSnooze(message);
              }}
              className="h-7 px-2 rounded-full bg-background/80 backdrop-blur-xl border border-border/40 text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
              aria-label="Snooze"
            >
              <Clock className="w-3 h-3" />
              Later
            </button>
          )}
          {onDone && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDone(message);
              }}
              className="h-7 px-2 rounded-full bg-background/80 backdrop-blur-xl border border-border/40 text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
              aria-label="Mark done"
            >
              <Check className="w-3 h-3" />
              Done
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(message);
              }}
              className="h-7 w-7 rounded-full bg-background/80 backdrop-blur-xl border border-border/40 text-muted-foreground hover:text-destructive hover:border-destructive/40 flex items-center justify-center"
              aria-label={message.source === "ghl" ? "Mark as read" : "Delete"}
              title={message.source === "ghl" ? "Mark as read" : "Delete"}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
