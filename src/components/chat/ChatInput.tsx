import { useState, useRef } from "react";
import { Send, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onRecordStart: () => void;
  onRecordStop: () => void;
  disabled?: boolean;
}

export const ChatInput = ({
  onSendMessage,
  onRecordStart,
  onRecordStop,
  disabled = false,
}: ChatInputProps) => {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { voiceState, setRecording } = useAppStore();

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSendMessage(text.trim());
    setText("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMicPress = () => {
    if (voiceState.isRecording) {
      setRecording(false);
      onRecordStop();
    } else {
      setRecording(true);
      onRecordStart();
    }
  };

  return (
    <div className="flex items-center gap-3 p-4 bg-background/80 backdrop-blur-xl border-t border-border/30 safe-area-bottom">
      <div className="flex-1 relative">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter query..."
          disabled={disabled}
          className="w-full h-12 px-5 pr-12 rounded-full bg-muted/50 border border-border/40 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-primary/10 hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center"
        >
          <Send className="w-4 h-4 text-primary" />
        </button>
      </div>

      <button
        onClick={handleMicPress}
        disabled={disabled}
        className={cn(
          "relative w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300",
          voiceState.isRecording
            ? "bg-destructive text-destructive-foreground scale-110"
            : "bg-primary text-primary-foreground hover:scale-105 active:scale-95"
        )}
      >
        {voiceState.isRecording ? (
          <Square className="w-5 h-5" />
        ) : (
          <Mic className="w-6 h-6" />
        )}
        {voiceState.isRecording && (
          <span className="absolute inset-0 rounded-full bg-destructive/30 animate-ping" />
        )}
      </button>
    </div>
  );
};
