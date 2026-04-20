import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2, BookOpen } from "lucide-react";
import { wisdomService } from "@/services/wisdomService";
import { toast } from "@/hooks/use-toast";

type Source = {
  id: string;
  person: string;
  title: string;
  type: string;
  entry_count: number;
  created_at: string;
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
}

export const SourceCard = ({ source, onDeleted }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!expanded && entries.length === 0) {
      setLoading(true);
      const data = await wisdomService.getEntries(source.id);
      setEntries(data.slice(0, 5) as Entry[]);
      setLoading(false);
    }
    setExpanded((v) => !v);
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
    <div className="rounded-2xl border border-border/40 bg-card/30 overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{source.person}</div>
          <div className="text-xs text-muted-foreground truncate">{source.title}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="px-1.5 py-0.5 rounded bg-muted/60">{source.type}</span>
            <span>{source.entry_count} entries</span>
            <span>·</span>
            <span>{new Date(source.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
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
