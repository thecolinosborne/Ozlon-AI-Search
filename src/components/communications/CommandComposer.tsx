import { useEffect, useRef, useState } from "react";
import { Mic, Send, Sparkles, Command as CmdIcon, Loader2, MicOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

export interface ComposerCommand {
  /** Slash command keyword without the leading slash (e.g. "draft") */
  keyword: string;
  /** Human-readable title shown in the palette */
  title: string;
  /** Short description shown beneath the title */
  description: string;
  /** Optional placeholder shown after the slash trigger expands */
  placeholder?: string;
}

interface CommandComposerProps {
  commands: ComposerCommand[];
  /** Called when the user submits — `command` is undefined for free-form text */
  onSubmit: (text: string, command?: ComposerCommand) => void;
  /** Optional placeholder when no command is selected */
  placeholder?: string;
  /** Disabled when a modal (ReplySheet) is open */
  disabled?: boolean;
}

/**
 * CommandComposer — persistent floating composer for the Communications page.
 *
 * Features:
 *  - Always-visible bar pinned above the bottom nav (mobile) / bottom-right (desktop)
 *  - ⌘K (or Ctrl+K) opens a full command palette with searchable slash commands
 *  - Typing "/" surfaces the same palette inline
 *  - Voice input via the existing Whisper recorder hook
 *  - Clean Apple Vision Pro–style glass surface; semantic tokens only
 */
export function CommandComposer({
  commands,
  onSubmit,
  placeholder = "Type / for commands, or speak…",
  disabled,
}: CommandComposerProps) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [activeCmd, setActiveCmd] = useState<ComposerCommand | null>(null);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const recorder = useVoiceRecorder({
    onTranscribed: (transcript) => {
      setText((t) => (t ? `${t} ${transcript}` : transcript));
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  });

  // Filter commands by the text after the slash (or full text in palette mode).
  const query = text.startsWith("/") ? text.slice(1).toLowerCase() : text.toLowerCase();
  const matches = !text.startsWith("/") && !open
    ? []
    : commands.filter(
        (c) =>
          c.keyword.toLowerCase().includes(query) ||
          c.title.toLowerCase().includes(query),
      );
  const showPalette = open || (text.startsWith("/") && matches.length > 0 && !activeCmd);

  // Global ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      } else if (e.key === "Escape" && open) {
        setOpen(false);
        setText("");
        setActiveCmd(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const reset = () => {
    setText("");
    setActiveCmd(null);
    setPaletteIdx(0);
    setOpen(false);
  };

  const submit = () => {
    const value = text.startsWith("/") && activeCmd ? text.slice(activeCmd.keyword.length + 1).trim() : text.trim();
    if (!value && !activeCmd) return;
    onSubmit(value, activeCmd ?? undefined);
    reset();
  };

  const pickCommand = (cmd: ComposerCommand) => {
    setActiveCmd(cmd);
    setText(`/${cmd.keyword} `);
    setOpen(false);
    setPaletteIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showPalette && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPaletteIdx((i) => Math.min(matches.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPaletteIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && text.startsWith("/"))) {
        e.preventDefault();
        pickCommand(matches[paletteIdx] ?? matches[0]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Backspace" && activeCmd && text === `/${activeCmd.keyword} `) {
      setActiveCmd(null);
    }
  };

  return (
    <>
      {/* Backdrop for full palette */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm animate-in fade-in"
          onClick={reset}
        />
      )}

      {/* Composer bar */}
      <div
        className={cn(
          "z-50 transition-all duration-300",
          open
            ? "fixed left-1/2 top-[18%] -translate-x-1/2 w-[min(92vw,640px)]"
            : "fixed bottom-3 left-1/2 -translate-x-1/2 w-[min(94vw,560px)] lg:left-auto lg:right-6 lg:translate-x-0",
        )}
      >
        <div
          className={cn(
            "rounded-2xl bg-card/80 backdrop-blur-2xl border border-border/40 shadow-xl",
            "ring-1 ring-inset ring-border/20",
            open && "ring-primary/20",
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            {activeCmd ? (
              <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-primary/15 text-primary text-[11px] font-medium">
                <Sparkles className="w-3 h-3" />
                {activeCmd.title}
                <button
                  onClick={() => {
                    setActiveCmd(null);
                    setText("");
                    inputRef.current?.focus();
                  }}
                  className="ml-0.5 hover:text-primary/70"
                  aria-label="Clear command"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ) : (
              <CmdIcon className="w-4 h-4 text-muted-foreground/70 shrink-0" />
            )}

            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPaletteIdx(0);
              }}
              onKeyDown={handleKey}
              onFocus={() => {
                if (text === "" && !open) {
                  // Soft hint of the palette
                }
              }}
              placeholder={activeCmd?.placeholder ?? placeholder}
              disabled={disabled || recorder.isTranscribing}
              className={cn(
                "flex-1 min-w-0 bg-transparent outline-none text-[14px] text-foreground placeholder:text-muted-foreground/60",
                "disabled:opacity-60",
              )}
              aria-label="Command composer"
            />

            <button
              onClick={() =>
                recorder.isRecording ? recorder.stopRecording() : recorder.startRecording()
              }
              disabled={disabled || recorder.isTranscribing}
              className={cn(
                "shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                recorder.isRecording
                  ? "bg-destructive/20 text-destructive animate-pulse"
                  : "bg-card/60 text-muted-foreground hover:text-foreground border border-border/30",
              )}
              aria-label={recorder.isRecording ? "Stop recording" : "Start voice input"}
            >
              {recorder.isTranscribing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : recorder.isRecording ? (
                <MicOff className="w-3.5 h-3.5" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              onClick={submit}
              disabled={disabled || (!text.trim() && !activeCmd)}
              className={cn(
                "shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all",
                text.trim() || activeCmd
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
                  : "bg-card/40 text-muted-foreground/50 cursor-not-allowed",
              )}
              aria-label="Send"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Palette dropdown */}
          {showPalette && matches.length > 0 && (
            <div className="border-t border-border/30 max-h-72 overflow-y-auto">
              {matches.map((cmd, i) => (
                <button
                  key={cmd.keyword}
                  onClick={() => pickCommand(cmd)}
                  onMouseEnter={() => setPaletteIdx(i)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors",
                    i === paletteIdx
                      ? "bg-primary/10"
                      : "hover:bg-card/40",
                  )}
                >
                  <span className="shrink-0 mt-0.5 w-6 h-6 rounded-md bg-card/60 border border-border/30 flex items-center justify-center text-muted-foreground">
                    <Sparkles className="w-3 h-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-medium text-foreground">
                        /{cmd.keyword}
                      </span>
                      <span className="text-[12px] text-muted-foreground truncate">
                        {cmd.title}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground/70 mt-0.5 line-clamp-1">
                      {cmd.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Footer hint */}
          {open && (
            <div className="border-t border-border/30 px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground/60">
              <span>↑↓ to navigate · ↵ to select · esc to close</span>
              <span>⌘K</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
