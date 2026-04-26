import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, Sparkles } from "lucide-react";
import { channelIcon, channelTint, formatTime } from "./channelStyle";
import type { CommMessage, CommChannel, TriageItem } from "@/hooks/useCommunicationsFeed";
import type { PersonGroup, RelationshipState } from "@/hooks/usePeopleView";

interface PeopleStreamProps {
  groups: PersonGroup[];
  triageMap?: Map<string, TriageItem>;
  onTap: (m: CommMessage) => void;
}

const RELATIONSHIP_LABEL: Record<RelationshipState, string> = {
  warm: "Warm",
  active: "Awaiting reply",
  cooling: "Cooling",
  ghosted: "Ghosted",
  broadcast: "Broadcast",
};

const RELATIONSHIP_TONE: Record<RelationshipState, string> = {
  warm: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  active: "bg-primary/15 text-primary border-primary/25",
  cooling: "bg-muted-foreground/10 text-muted-foreground border-border/30",
  ghosted: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  broadcast: "bg-card/60 text-muted-foreground/70 border-border/20",
};

function formatLatency(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function PeopleStream({ groups, triageMap, onTap }: PeopleStreamProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="pb-8">
      {groups.map((g) => {
        const expanded = expandedKey === g.key;
        return (
          <Fragment key={g.key}>
            <PersonRow
              group={g}
              expanded={expanded}
              onToggle={() => setExpandedKey(expanded ? null : g.key)}
              onJump={() => onTap(g.latest)}
            />
            {expanded && (
              <div className="bg-card/20 border-y border-border/20">
                {g.messages.slice(0, 8).map((m) => (
                  <ThreadRow
                    key={m.id}
                    message={m}
                    triage={triageMap?.get(m.id)}
                    onTap={onTap}
                  />
                ))}
                {g.messages.length > 8 && (
                  <div className="px-4 lg:px-6 py-2 text-[11px] text-muted-foreground/70">
                    +{g.messages.length - 8} earlier messages
                  </div>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

interface PersonRowProps {
  group: PersonGroup;
  expanded: boolean;
  onToggle: () => void;
  onJump: () => void;
}

function PersonRow({ group, expanded, onToggle, onJump }: PersonRowProps) {
  return (
    <div
      className={cn(
        "group relative w-full flex items-start gap-3 px-4 lg:px-6 py-3.5 cursor-pointer transition-colors",
        "hover:bg-card/30 active:bg-card/50",
        "border-t border-border/10",
        expanded && "bg-card/30",
      )}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-full bg-card/60 backdrop-blur-xl border border-border/30 flex items-center justify-center text-[11px] font-medium text-foreground/80">
          {initials(group.name) || "?"}
        </div>
        {/* Channel pip cluster */}
        <div className="absolute -bottom-0.5 -right-0.5 flex -space-x-1">
          {Array.from(group.channels)
            .slice(0, 3)
            .map((c, i) => (
              <ChannelPip key={`${c}-${i}`} channel={c} />
            ))}
        </div>
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-medium text-foreground truncate">
            {group.name}
            {group.messages.length > 1 && (
              <span className="text-muted-foreground font-normal">
                {" "}· {group.messages.length}
              </span>
            )}
          </span>
          <span className="text-[12px] tabular-nums text-muted-foreground/80 shrink-0">
            {formatLatency(group.hoursSinceLast)}
          </span>
        </div>

        <p className="text-[13px] text-muted-foreground line-clamp-1 mt-0.5 leading-snug">
          {group.latest.subject || group.latest.preview}
        </p>

        {/* Meta row: relationship state, urgency, counts */}
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium border",
              RELATIONSHIP_TONE[group.relationship],
            )}
          >
            {RELATIONSHIP_LABEL[group.relationship]}
          </span>

          {group.needsReplyCount > 0 && (
            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-primary/10 text-primary text-[10px] font-medium border border-primary/20">
              {group.needsReplyCount} reply
            </span>
          )}

          {group.unreadCount > 0 && (
            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-card/60 text-muted-foreground text-[10px] font-medium border border-border/30">
              {group.unreadCount} unread
            </span>
          )}

          {group.topUrgency === "high" && (
            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-amber-500/15 text-amber-300 text-[10px] font-medium border border-amber-500/25">
              <Sparkles className="w-2.5 h-2.5" />
              Urgent
            </span>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onJump();
            }}
            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 h-5 px-2 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20"
          >
            Open latest
          </button>
        </div>
      </div>

      {/* Expand chevron */}
      <ChevronRight
        className={cn(
          "w-4 h-4 text-muted-foreground/60 mt-2 shrink-0 transition-transform",
          expanded && "rotate-90",
        )}
      />
    </div>
  );
}

function ChannelPip({ channel }: { channel: CommChannel }) {
  const Icon = channelIcon(channel);
  const tint = channelTint(channel);
  return (
    <span
      className="w-3.5 h-3.5 rounded-full ring-2 ring-background flex items-center justify-center"
      style={{ background: tint }}
      aria-label={channel}
    >
      <Icon className="w-2 h-2 text-background" />
    </span>
  );
}

interface ThreadRowProps {
  message: CommMessage;
  triage?: TriageItem;
  onTap: (m: CommMessage) => void;
}

function ThreadRow({ message, triage, onTap }: ThreadRowProps) {
  const Icon = channelIcon(message.channel);
  return (
    <button
      onClick={() => onTap(message)}
      className="w-full text-left flex items-start gap-3 px-6 lg:px-12 py-2.5 hover:bg-card/40 transition-colors border-t border-border/10"
    >
      <div className="shrink-0 w-6 h-6 rounded-full bg-card/60 border border-border/20 flex items-center justify-center mt-0.5">
        <Icon className="w-3 h-3 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-medium text-foreground/90 truncate">
            {message.subject || message.channelLabel}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground/70 shrink-0">
            {formatTime(message.receivedAt)}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground line-clamp-1 mt-0.5">
          {message.preview}
        </p>
        {triage?.reason && (
          <p className="mt-0.5 text-[10.5px] text-primary/70 line-clamp-1 flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5 shrink-0" />
            {triage.reason}
          </p>
        )}
      </div>
    </button>
  );
}
