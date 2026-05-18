import { useRef, useEffect, useState, memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Volume2, VolumeX, Check, AlertCircle, ChevronDown, ChevronRight, Cog, Copy, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, LiveStep } from "@/hooks/useChatStream";
import type { FormatMode } from "@/services/chatService";
import { RoutingChip } from "./RoutingChip";
import { KnowledgeChip } from "./KnowledgeChip";
import { InvestigationCard } from "./InvestigationCard";
import { ResearchCard } from "./ResearchCard";
import { TripPlanArtifact } from "@/components/trip/TripPlanArtifact";
import { ReformatChip } from "./ReformatChip";

const StepIcon = ({ status }: { status: LiveStep["status"] }) => {
  if (status === "done") return <Check className="w-3 h-3 text-emerald-500" />;
  if (status === "error") return <AlertCircle className="w-3 h-3 text-destructive" />;
  return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
};

const LiveStepsStrip = ({ steps, collapsed: initialCollapsed }: { steps: LiveStep[]; collapsed: boolean }) => {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  useEffect(() => { setCollapsed(initialCollapsed); }, [initialCollapsed]);

  if (steps.length === 0) return null;

  if (collapsed) {
    const doneCount = steps.filter((s) => s.status === "done").length;
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="not-prose mb-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className="w-3 h-3" />
        <Cog className="w-3 h-3" />
        <span>Done in {doneCount} step{doneCount === 1 ? "" : "s"}</span>
      </button>
    );
  }

  return (
    <div className="not-prose mb-2 rounded-lg border border-border/30 bg-muted/30 px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-1"
      >
        <ChevronDown className="w-3 h-3" />
        <span>Working ({steps.length})</span>
      </button>
      <ul className="space-y-1">
        {steps.map((step, i) => (
          <li key={`${step.label}-${i}`} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <StepIcon status={step.status} />
            <span className={cn("truncate", step.status === "done" && "text-foreground/70")}>{step.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// Auto-link bare URLs (http/https/www.) that aren't already inside a markdown link.
const linkifyPlainUrls = (text: string): string => {
  // Skip transformation inside fenced code blocks
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

interface ChatMessageListProps {
  messages: ChatMessage[];
  playMessage: (id: string, text: string) => void;
  playingMessageId: string | null;
  loadingAudioId: string | null;
  onRegenerate?: (messageId: string) => void;
  onReformat?: (messageId: string, mode: FormatMode) => void;
  isLoading?: boolean;
}

const ActionIconButton = ({
  onClick,
  disabled,
  active,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    className={cn(
      "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors",
      "text-muted-foreground hover:text-foreground hover:bg-muted/60",
      "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
      active && "text-foreground"
    )}
  >
    {children}
  </button>
);

const CopyAction = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <ActionIconButton onClick={handle} title={copied ? "Copied" : "Copy"} active={copied}>
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </ActionIconButton>
  );
};

interface MessageItemProps {
  message: ChatMessage;
  playMessage: (id: string, text: string) => void;
  playingMessageId: string | null;
  loadingAudioId: string | null;
  onRegenerate?: (messageId: string) => void;
  isLoading?: boolean;
}

const MessageItemInner = ({
  message,
  playMessage,
  playingMessageId,
  loadingAudioId,
  onRegenerate,
  isLoading,
}: MessageItemProps) => {
  const markdownContent = useMemo(
    () => (message.content ? linkifyPlainUrls(message.content) : ""),
    [message.content]
  );

  const markdownComponents = useMemo(
    () => ({
      a: ({ href, children, ...props }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      ),
      pre: ({ children, ...props }: any) => {
        const extractText = (node: any): string => {
          if (node == null) return "";
          if (typeof node === "string") return node;
          if (Array.isArray(node)) return node.map(extractText).join("");
          if (node.props?.children) return extractText(node.props.children);
          return "";
        };
        const text = extractText(children);
        const blockId = `${message.id}-block-${text.slice(0, 24)}`;
        return (
          <div className="not-prose group relative my-2 rounded-lg border border-border/40 bg-muted">
            <pre {...props} className="whitespace-pre-wrap break-words p-3 pr-3 text-sm text-foreground overflow-hidden">
              {children}
            </pre>
            <div className="flex items-center justify-end gap-0.5 border-t border-border/30 px-1 py-1">
              <CopyAction text={text} />
              <ActionIconButton
                onClick={() => playMessage(blockId, text)}
                disabled={loadingAudioId === blockId}
                active={playingMessageId === blockId}
                title={playingMessageId === blockId ? "Stop" : "Speak"}
              >
                {loadingAudioId === blockId ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : playingMessageId === blockId ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </ActionIconButton>
              {onRegenerate && (
                <ActionIconButton
                  onClick={() => onRegenerate(message.id)}
                  disabled={isLoading}
                  title="Regenerate"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </ActionIconButton>
              )}
            </div>
          </div>
        );
      },
    }),
    [message.id, playMessage, playingMessageId, loadingAudioId, onRegenerate, isLoading]
  );

  return (
    <div
      className={cn(
        "flex flex-col",
        message.role === "user" ? "items-end" : "items-start"
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
          message.role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-card/60 backdrop-blur-md border border-border/30 text-foreground"
        )}
      >
        {message.role === "assistant" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:whitespace-pre-wrap [&_code]:break-words prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-h2:mt-4 prose-h2:mb-2 prose-h3:mt-3 prose-h3:mb-1.5 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:marker:text-muted-foreground prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:border prose-pre:border-border/40 prose-pre:rounded-lg prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:bg-muted/30 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:not-italic prose-table:text-xs prose-th:bg-muted/50 prose-th:font-semibold prose-td:border prose-td:border-border/30 prose-th:border prose-th:border-border/30 prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-hr:border-border/40">
            {message.liveSteps && message.liveSteps.length > 0 && (
              <LiveStepsStrip
                steps={message.liveSteps}
                collapsed={Boolean(message.content)}
              />
            )}
            {message.content ? (
              <ReactMarkdown
                components={markdownComponents}
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => url}
              >
                {markdownContent}
              </ReactMarkdown>
            ) : (!message.liveSteps || message.liveSteps.length === 0) ? (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse delay-75" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse delay-150" />
              </span>
            ) : null}
            {message.content && message.artifactId && (
              <InvestigationCard artifactId={message.artifactId} />
            )}
            {message.content && message.researchReportId && (
              <ResearchCard reportId={message.researchReportId} />
            )}
            {message.tripOptionId && (
              <TripPlanArtifact tripOptionId={message.tripOptionId} />
            )}
            {message.content && (message.provider || (message.toolsUsed && message.toolsUsed.length > 0) || message.orchestration) && (
              <div className="mt-2 not-prose flex flex-wrap items-center gap-2">
                {message.provider ? (
                  <RoutingChip
                    provider={message.provider}
                    toolsUsed={message.toolsUsed}
                  />
                ) : message.toolsUsed && message.toolsUsed.length > 0 ? (
                  <div className="flex flex-wrap gap-1 items-center text-[10px] text-muted-foreground/70">
                    <span>tools:</span>
                    {message.toolsUsed.map((t) => (
                      <span
                        key={t.name}
                        className="px-1.5 py-0.5 rounded bg-muted/60 text-foreground/70"
                        title={t.name}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {message.orchestration && (
                  <KnowledgeChip orchestration={message.orchestration} />
                )}
              </div>
            )}
            {message.content && message.provider && (
              <div className="mt-1.5 not-prose text-[10px] text-muted-foreground/60">
                via <span className="font-mono text-foreground/70">{message.provider.model}</span>
                {typeof message.provider.latency_ms === "number" && (
                  <> · {(message.provider.latency_ms / 1000).toFixed(1)}s</>
                )}
                {message.provider.routing_mode && (
                  <> · {message.provider.routing_mode}</>
                )}
              </div>
            )}
          </div>
        ) : (
          <span className="whitespace-pre-wrap">{message.content}</span>
        )}
      </div>
      {message.role === "user" && message.content && (
        <div className="mt-1.5 flex items-center gap-0.5 -mr-1">
          <CopyAction text={message.content} />
        </div>
      )}
      {message.role === "assistant" && message.content && (
        <div className="mt-1.5 flex items-center gap-0.5 -ml-1">
          <CopyAction text={message.content} />
          <ActionIconButton
            onClick={() => playMessage(message.id, message.content)}
            disabled={loadingAudioId === message.id}
            active={playingMessageId === message.id}
            title={playingMessageId === message.id ? "Stop" : "Speak"}
          >
            {loadingAudioId === message.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : playingMessageId === message.id ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </ActionIconButton>
          {onRegenerate && (
            <ActionIconButton
              onClick={() => onRegenerate(message.id)}
              disabled={isLoading}
              title="Regenerate"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </ActionIconButton>
          )}
        </div>
      )}
    </div>
  );
};

const MessageItem = memo(MessageItemInner, (prev, next) => {
  // Re-render only when something visually relevant to THIS message changes.
  if (prev.message !== next.message) return false;
  if (prev.isLoading !== next.isLoading) return false;
  if (prev.onRegenerate !== next.onRegenerate) return false;
  if (prev.playMessage !== next.playMessage) return false;
  // Playing/loading state matters only if it concerns this message or one of its blocks.
  const id = next.message.id;
  const playingChanged = prev.playingMessageId !== next.playingMessageId;
  const loadingChanged = prev.loadingAudioId !== next.loadingAudioId;
  if (playingChanged) {
    const wasMine = prev.playingMessageId?.startsWith(id);
    const isMine = next.playingMessageId?.startsWith(id);
    if (wasMine || isMine) return false;
  }
  if (loadingChanged) {
    const wasMine = prev.loadingAudioId?.startsWith(id);
    const isMine = next.loadingAudioId?.startsWith(id);
    if (wasMine || isMine) return false;
  }
  return true;
});

export const ChatMessageList = ({
  messages,
  playMessage,
  playingMessageId,
  loadingAudioId,
  onRegenerate,
  isLoading,
}: ChatMessageListProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-20 pb-36">
      <div className="max-w-2xl mx-auto space-y-4">
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            playMessage={playMessage}
            playingMessageId={playingMessageId}
            loadingAudioId={loadingAudioId}
            onRegenerate={onRegenerate}
            isLoading={isLoading}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};
