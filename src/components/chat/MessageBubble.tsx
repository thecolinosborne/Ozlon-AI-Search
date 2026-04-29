import { cn } from "@/lib/utils";
import type { Message } from "@/types";
import { AIOrb } from "@/components/AIOrb";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessagePlayButton } from "./MessagePlayButton";

const linkifyPlainUrls = (text: string): string => {
  const parts = text.split(/(```[\s\S]*?```|`[^`]*`)/g);
  const urlRe = /(?<![\(\[`])((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"])/g;
  return parts
    .map((p, i) =>
      i % 2 === 1
        ? p
        : p.replace(urlRe, (m) => {
            const href = m.startsWith("www.") ? `https://${m}` : m;
            return `[${m}](${href})`;
          })
    )
    .join("");
};

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
          ) : isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
          ) : (
            <div className="text-sm leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-a:text-primary prose-a:underline hover:prose-a:opacity-80 break-words prose-h2:text-[11px] prose-h2:font-semibold prose-h2:uppercase prose-h2:tracking-[0.1em] prose-h2:text-muted-foreground/80 prose-h2:mt-4 prose-h2:mb-1.5 prose-h2:first:mt-0 prose-h3:text-[12px] prose-h3:font-semibold prose-h3:text-foreground/90 prose-h3:mt-3 prose-h3:mb-1 prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground prose-blockquote:not-italic prose-blockquote:py-0 prose-blockquote:pl-3 prose-blockquote:my-2 prose-blockquote:text-[11px] prose-blockquote:font-medium prose-blockquote:uppercase prose-blockquote:tracking-[0.08em]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...props }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                      {children}
                    </a>
                  ),
                }}
              >
                {linkifyPlainUrls(message.text)}
              </ReactMarkdown>
            </div>
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

        <div className="flex items-center gap-2 mt-1 px-2">
          <span className="text-[10px] text-muted-foreground/60">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {!isUser && !message.isLoading && message.text && (
            <MessagePlayButton text={message.text} />
          )}
        </div>
      </div>
    </div>
  );
};
