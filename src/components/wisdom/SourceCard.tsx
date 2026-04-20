import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2, BookOpen, Zap, ZapOff } from "lucide-react";
import { wisdomService } from "@/services/wisdomService";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Source = {
  id: string;
  person: string;
  title: string;
  type: string;
  entry_count: number;
  created_at: string;
  is_active?: boolean;
};

type Entry = {
  id: string;
  title: string;
  content: string;
  category: string;
  domain: string;
};

interface Props {
  source: Source;
  onDeleted?: () => void;
  onChanged?: () => void;
}

export const SourceCard = ({ source, onDeleted, onChanged }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(source.is_active !== false);
  const [toggling, setToggling] = useState(false);

  const toggle = async () => {
    if (!expanded && entries.length === 0) {
      setLoading(true);
      const data = await wisdomService.getEntries(source.id);
      setEntries(data.slice(0, 5) as Entry[]);
      setLoading(false);
    }
    setExpanded((v) => !v);
  };

  const togglePlug = async () => {
    setToggling(true);
    const next = !active;
    const ok = await wisdomService.setSourceActive(source.id, next);
    if (ok) {
      setActive(next);
      toast({
        title: next ? "Plugged in" : "Unplugged",
        description: next
          ? `${source.title} is now influencing the system.`
          : `${source.title} is dormant — data preserved.`,
      });
      onChanged?.();
    } else {
      toast({ title: "Failed to toggle", variant: "destructive" });
    }
    setToggling(false);
  };

  const remove = async () => {
    if (!confirm(`Remove "${source.title}" and all its entries?`)) return;
    const ok = await wisdomService.deleteSource(source.id);
    if (ok) {
      toast({ title: "Removed", description: source.title });
      onDeleted?.();
    } else {
      toast({ title: "Failed to remove", variant: "destructive" });
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/30 overflow-hidden transition-all",
        active
          ? "border-primary/30 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
          : "border-border/40 opacity-70"
      )}
    >
      <div className="p-4 flex items-start gap-3">
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
            active ? "bg-primary/10" : "bg-muted/40"
          )}
        >
          <BookOpen className={cn("w-4 h-4", active ? "text-primary" : "text-muted-foreground")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{source.person}</div>
          <div className="text-xs text-muted-foreground truncate">{source.title}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-muted/60">{source.type}</span>
            <span>{source.entry_count} entries</span>
            <span>·</span>
            <span>{new Date(source.created_at).toLocaleDateString()}</span>
            {active ? (
              <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                Plugged in
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                Unplugged
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={togglePlug}
            disabled={toggling}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              active
                ? "text-primary hover:bg-primary/10"
                : "text-muted-foreground hover:bg-muted/60"
            )}
            aria-label={active ? "Unplug" : "Plug in"}
            title={active ? "Unplug — keeps data, removes influence" : "Plug in — activate influence"}
          >
            {active ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
          </button>
          <button
            onClick={toggle}
            className="p-1.5 hover:bg-muted/60 rounded-md text-muted-foreground"
            aria-label="Expand"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={remove}
            className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-md text-muted-foreground"
            aria-label="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-2 border-t border-border/30">
          {loading ? (
            <div className="text-xs text-muted-foreground py-2">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No entries</div>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="pt-3">
                <div className="text-xs font-semibold">{e.title}</div>
                <div className="text-[11px] text-muted-foreground mb-1">
                  {e.category} · {e.domain}
                </div>
                <div className="text-xs text-foreground/80 leading-relaxed">{e.content}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
