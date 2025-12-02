import { cn } from "@/lib/utils";
import type { Message } from "@/types";
import { AIOrb } from "@/components/AIOrb";

interface MessageBubbleProps {
  message: Message;
  onAction?: (action: string) => void;
}

export const MessageBubble = ({ message, onAction }: MessageBubbleProps) => {
  const isUser = message.sender === "user";

  return (
    <div
      className={cn(
        "flex gap-3 px-4 animate-slide-up-fade",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <AIOrb breatheIn={true} />
        </div>
      )}
      
      <div className={cn("flex flex-col max-w-[80%]", isUser && "items-end")}>
        <div
          className={cn(
            "px-5 py-4 rounded-3xl",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-lg"
              : "bg-card/60 backdrop-blur-md border border-border/30 rounded-bl-lg"
          )}
        >
          {message.isLoading ? (
            <div className="flex items-center gap-2">
              <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent rounded-full animate-pulse" />
            </div>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
          )}
        </div>

        {!isUser && message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {message.actions.map((action, index) => (
              <button
                key={index}
                onClick={() => onAction?.(action)}
                className="px-4 py-2 text-xs font-medium rounded-full bg-muted/60 hover:bg-muted border border-border/40 text-foreground/80 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              >
                {action}
              </button>
            ))}
          </div>
        )}

        <span className="text-[10px] text-muted-foreground/60 mt-1 px-2">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
};
