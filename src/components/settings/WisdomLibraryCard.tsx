import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Type, Upload, Link as LinkIcon, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { wisdomService } from "@/services/wisdomService";
import { cn } from "@/lib/utils";

const tiles = [
  {
    mode: "text",
    icon: Type,
    label: "Paste Text",
    description: "Drop in a chapter or transcript",
  },
  {
    mode: "upload",
    icon: Upload,
    label: "Upload Document",
    description: "PDF, DOCX, TXT, MD",
  },
  {
    mode: "url",
    icon: LinkIcon,
    label: "From URL",
    description: "Article or blog post",
  },
] as const;

export const WisdomLibraryCard = () => {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ sources: 0, entries: 0, memories: 0 });

  useEffect(() => {
    wisdomService.getCounts().then(setCounts).catch(() => {});
  }, []);

  const isEmpty = counts.sources === 0;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl p-5 sm:p-6",
        "bg-gradient-to-br from-card/80 via-card/50 to-card/30",
        "border border-border/40 backdrop-blur-xl",
      )}
    >
      <div
        aria-hidden
        className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative flex items-start gap-4 mb-5">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
          <Brain className="w-5 h-5 text-primary" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-foreground">Wisdom Library</h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary">
              New
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isEmpty
              ? "Pour minds, books, and notes into your OS."
              : "Make your AI smarter — ingest a new source."}
          </p>
        </div>
      </div>

      {/* Stat strip */}
      <div className="relative grid grid-cols-3 gap-2 mb-5 p-3 rounded-2xl bg-muted/40 border border-border/30">
        {[
          { label: "Sources", value: counts.sources },
          { label: "Entries", value: counts.entries },
          { label: "Memories", value: counts.memories },
        ].map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="text-xl font-semibold text-foreground tabular-nums">
              {stat.value}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mt-0.5">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Quick action tiles */}
      <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.mode}
              onClick={() => navigate(`/wisdom?mode=${tile.mode}`)}
              className={cn(
                "group flex flex-col items-start gap-2 p-3 rounded-2xl text-left",
                "bg-card/60 hover:bg-card border border-border/40",
                "transition-all duration-200",
                "hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.3)]",
              )}
            >
              <div className="p-2 rounded-xl bg-gradient-to-br from-muted/80 to-muted/40 group-hover:from-primary/20 group-hover:to-primary/5 transition-colors">
                <Icon
                  className="w-4 h-4 text-foreground/70 group-hover:text-primary transition-colors"
                  strokeWidth={1.5}
                />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">{tile.label}</div>
                <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                  {tile.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/wisdom")}
          className="w-full sm:w-auto rounded-full text-primary hover:text-primary hover:bg-primary/10"
        >
          Open Library
          <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
        </Button>
      </div>
    </div>
  );
};
