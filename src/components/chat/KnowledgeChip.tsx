import { useState } from "react";
import { Sparkles, Brain } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { OrchestrationTraceEvent } from "@/services/chatService";

interface KnowledgeChipProps {
  orchestration: OrchestrationTraceEvent;
}

export const KnowledgeChip = ({ orchestration }: KnowledgeChipProps) => {
  const [open, setOpen] = useState(false);
  const { wisdom_signal, frameworks_injected, memories_injected, reflections_injected } =
    orchestration;

  const totalSources =
    (wisdom_signal?.resonant_sources?.length || 0) +
    (memories_injected?.length || 0) +
    (reflections_injected?.length || 0);

  if (totalSources === 0) return null;

  const frameworkNames = wisdom_signal?.framework_hits || [];
  const labelText =
    frameworkNames.length > 0
      ? `Drew from ${frameworkNames.slice(0, 2).join(", ")}${frameworkNames.length > 2 ? ` +${frameworkNames.length - 2}` : ""}`
      : `Drew from ${totalSources} source${totalSources === 1 ? "" : "s"}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 hover:bg-primary/15 border border-primary/20 text-[10px] font-medium text-primary transition-colors"
          title="Wisdom influenced this response"
        >
          <Sparkles className="w-3 h-3" />
          {labelText}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold">Wisdom influence</h4>
          </div>

          {wisdom_signal?.dominant_domains?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Domains
              </div>
              <div className="flex flex-wrap gap-1">
                {wisdom_signal.dominant_domains.map((d) => (
                  <span
                    key={d}
                    className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-foreground/80"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {frameworks_injected?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Active Frameworks
              </div>
              <ul className="space-y-1">
                {frameworks_injected.map((f) => (
                  <li key={f.id} className="text-xs text-foreground/90 truncate">
                    • {f.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {memories_injected?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Personal Memories
              </div>
              <ul className="space-y-1">
                {memories_injected.map((m) => (
                  <li key={m.id} className="text-xs text-foreground/90 truncate">
                    • {m.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {wisdom_signal?.resonant_sources?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Sources
              </div>
              <ul className="space-y-1">
                {wisdom_signal.resonant_sources.slice(0, 5).map((s) => (
                  <li
                    key={s.id}
                    className="text-xs text-foreground/80 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {s.person && s.person !== "Unknown" ? `${s.person} — ` : ""}
                      {s.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {Math.round(s.similarity * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {orchestration.tools_reordered && (
            <div className="text-[10px] text-primary/80 italic">
              Tools reordered by wisdom domains
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
