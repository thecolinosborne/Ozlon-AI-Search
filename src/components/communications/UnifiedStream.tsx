import { Fragment, useMemo } from "react";
import { MessageRow } from "./MessageRow";
import { dateBucket } from "./channelStyle";
import type { CommMessage } from "@/hooks/useCommunicationsFeed";

interface UnifiedStreamProps {
  messages: CommMessage[];
  onTap: (m: CommMessage) => void;
  onDone?: (m: CommMessage) => void;
  onSnooze?: (m: CommMessage) => void;
}

export function UnifiedStream({ messages, onTap, onDone, onSnooze }: UnifiedStreamProps) {
  const grouped = useMemo(() => {
    const groups: { bucket: string; items: CommMessage[] }[] = [];
    for (const m of messages) {
      const bucket = dateBucket(m.receivedAt);
      const last = groups[groups.length - 1];
      if (last && last.bucket === bucket) last.items.push(m);
      else groups.push({ bucket, items: [m] });
    }
    return groups;
  }, [messages]);

  return (
    <div className="pb-8">
      {grouped.map((g) => (
        <Fragment key={g.bucket}>
          <div className="px-4 lg:px-6 pt-5 pb-1.5">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
              {g.bucket}
            </span>
          </div>
          <div className="border-t border-border/20">
            {g.items.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                onTap={onTap}
                onDone={onDone}
                onSnooze={onSnooze}
              />
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
