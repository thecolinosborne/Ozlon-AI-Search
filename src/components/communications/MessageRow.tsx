import { cn } from "@/lib/utils";
import { channelIcon, channelTint, formatTime } from "./channelStyle";
import { VoicemailInline } from "./VoicemailInline";
import type { CommMessage } from "@/hooks/useCommunicationsFeed";

interface MessageRowProps {
  message: CommMessage;
  onTap: (m: CommMessage) => void;
}

export function MessageRow({ message, onTap }: MessageRowProps) {
  const Icon = channelIcon(message.channel);
  const tint = channelTint(message.channel);

  return (
    <button
      onClick={() => onTap(message)}
      className={cn(
        "w-full text-left flex items-start gap-3 px-4 lg:px-6 py-3.5",
        "hover:bg-card/30 active:bg-card/50 transition-colors",
        "focus-visible:outline-none focus-visible:bg-card/30",
      )}
    >
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
              {message.preview}
            </p>
          </div>
        ) : (
          <p className="text-[13.5px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
            {message.preview}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {message.channelLabel}
          </span>
          {message.needsReply && (
            <span className="text-[10px] uppercase tracking-wider text-primary/80">
              · Needs reply
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
    </button>
  );
}
