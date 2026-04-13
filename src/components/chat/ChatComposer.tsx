import React, { useRef } from "react";
import { Mic, Square, Send, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { AttachmentChips } from "./AttachmentChips";

interface ChatComposerProps {
  mode: "hero" | "docked";
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onMicClick: () => void;
  isRecording: boolean;
  isTranscribing: boolean;
  isLoading: boolean;
  placeholder: string;
  attachedFiles: File[];
  onRemoveFile: (index: number) => void;
  onAttach: () => void;
  getFileIcon: (file: File) => React.ReactNode;
}

export const ChatComposer = ({
  mode,
  input,
  onInputChange,
  onSubmit,
  onMicClick,
  isRecording,
  isTranscribing,
  isLoading,
  placeholder,
  attachedFiles,
  onRemoveFile,
  onAttach,
  getFileIcon,
}: ChatComposerProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isHero = mode === "hero";
  const isProcessing = isTranscribing;
  const hasContent = input.trim() || attachedFiles.length > 0;

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handleFormSubmit} className={isHero ? "w-full max-w-2xl px-4" : "max-w-2xl mx-auto"}>
      <AttachmentChips
        files={attachedFiles}
        onRemove={onRemoveFile}
        getFileIcon={getFileIcon}
        size={isHero ? "normal" : "small"}
      />

      <div className="relative group">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            onInputChange(e.target.value);
            autoResize(e.target);
          }}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? "Recording..." : placeholder}
          disabled={isLoading || isRecording}
          rows={1}
          className={cn(
            "w-full resize-none border border-neutral-200 shadow-sm",
            "focus:outline-none focus:border-neutral-300 focus:shadow-md",
            "transition-all duration-200",
            "placeholder:text-neutral-400",
            "disabled:opacity-50",
            isHero
              ? "px-6 py-4 pl-14 text-base rounded-3xl"
              : "px-5 py-3 pl-12 pr-20 text-sm rounded-2xl",
            isRecording && "border-red-300 bg-red-50/30"
          )}
        />

        {/* Paperclip */}
        <button
          type="button"
          onClick={onAttach}
          className={cn(
            "absolute text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-full transition-all",
            isHero ? "left-4 top-4 p-2" : "left-3 top-3 p-1.5"
          )}
          title="Attach files"
        >
          <Paperclip className={isHero ? "w-5 h-5" : "w-4 h-4"} />
        </button>

        {/* Right actions */}
        <div className={cn(
          "absolute flex items-center",
          isHero ? "right-4 top-4 gap-2" : "right-3 top-3 gap-1"
        )}>
          {hasContent && !isRecording && (
            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                "text-neutral-400 hover:text-neutral-600 transition-colors",
                isHero ? "p-2" : "p-1.5"
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          )}

          {/* Mic button */}
          <button
            type="button"
            onClick={onMicClick}
            disabled={isProcessing || isLoading}
            className={cn(
              "relative rounded-full flex items-center justify-center transition-all duration-300",
              isHero ? "p-2" : "w-8 h-8",
              isRecording
                ? "bg-red-500 text-white"
                : "text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100",
              isProcessing && "opacity-50 cursor-not-allowed",
              isRecording && "animate-pulse"
            )}
          >
            {isProcessing ? (
              <div className={cn(
                "border-2 border-current border-t-transparent rounded-full animate-spin",
                isHero ? "w-4 h-4" : "w-3 h-3"
              )} />
            ) : isRecording ? (
              <Square className={cn(isHero ? "w-4 h-4" : "w-3 h-3", "fill-current")} />
            ) : (
              <Mic className={isHero ? "w-5 h-5" : "w-4 h-4"} />
            )}
            {isRecording && (
              <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
            )}
          </button>
        </div>
      </div>
    </form>
  );
};
