import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BriefMeOverlayProps {
  open: boolean;
  isPlaying: boolean;
  script: string;
  onClose: () => void;
}

export function BriefMeOverlay({ open, isPlaying, script, onClose }: BriefMeOverlayProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-background/90 backdrop-blur-2xl flex flex-col items-center justify-center p-6 animate-slide-up-fade">
      <button
        onClick={onClose}
        className="absolute top-6 right-6 w-9 h-9 rounded-full bg-card/60 backdrop-blur-xl border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Close brief"
      >
        <X className="w-4 h-4" />
      </button>

      <div
        className={cn(
          "w-32 h-32 rounded-full bg-gradient-to-br from-primary to-primary/40",
          "shadow-[var(--ai-message-glow)]",
          isPlaying ? "animate-glow-pulse" : "animate-breathe",
        )}
        aria-hidden
      />

      <p className="mt-10 max-w-md text-center text-base text-foreground leading-relaxed">
        {script}
      </p>

      <p className="mt-6 text-[11px] uppercase tracking-wider text-muted-foreground/60">
        {isPlaying ? "Speaking…" : "Tap anywhere to dismiss"}
      </p>

      <button
        onClick={onClose}
        className="absolute inset-0 -z-10"
        aria-label="Dismiss brief"
      />
    </div>
  );
}
