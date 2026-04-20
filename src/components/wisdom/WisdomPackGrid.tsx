import { useEffect, useState } from "react";
import { Sparkles, Loader2, Check } from "lucide-react";
import { wisdomService, type WisdomPack } from "@/services/wisdomService";
import { toast } from "@/hooks/use-toast";

interface Props {
  onInstalled?: () => void;
}

export const WisdomPackGrid = ({ onInstalled }: Props) => {
  const [packs, setPacks] = useState<WisdomPack[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    wisdomService.listPacks().then(setPacks);
  }, []);

  const install = async (pack: WisdomPack) => {
    setLoadingId(pack.id);
    try {
      const res = await wisdomService.installPack(pack.id);
      if (res.success) {
        setInstalled((p) => ({ ...p, [pack.id]: true }));
        toast({
          title: res.already_installed ? "Already installed" : "Pack installed",
          description: `${pack.person} — ${pack.entry_count} entries available`,
        });
        onInstalled?.();
      } else {
        toast({ title: "Install failed", description: res.error, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Install failed", description: String(e), variant: "destructive" });
    } finally {
      setLoadingId(null);
    }
  };

  if (packs.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Wisdom Packs
        </h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {packs.map((p) => {
          const isLoading = loadingId === p.id;
          const isDone = installed[p.id];
          return (
            <button
              key={p.id}
              onClick={() => install(p)}
              disabled={isLoading || isDone}
              className="text-left p-4 rounded-2xl border border-border/50 bg-card/40 hover:bg-card/70 hover:border-primary/40 transition-all disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{p.person}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.title}</div>
                </div>
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                ) : isDone ? (
                  <Check className="w-4 h-4 text-primary flex-shrink-0" />
                ) : null}
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                {p.entry_count} curated frameworks
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
