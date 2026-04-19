// Shared thread surface: chat history with inline artifacts + composer.
// Used by both the Tasks detail sheet and (optionally) the chat page.

import { useEffect, useRef, useState } from 'react';
import { useThread } from '@/hooks/useThread';
import { ArtifactRenderer } from './ArtifactRenderer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AIOrb } from '@/components/AIOrb';
import { Send, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface Props {
  threadId: string;
  showHeader?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  awaiting_user: 'Awaiting you',
  working: 'Working',
  scheduled: 'Scheduled',
  blocked: 'Blocked',
  done: 'Done',
};

export function ThreadView({ threadId, showHeader = true }: Props) {
  const { thread, messages, artifacts, latestArtifact, sendFollowUp, loading } = useThread(threadId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, artifacts.length]);

  const send = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    const text = input;
    setInput('');
    try {
      await sendFollowUp(text);
    } finally {
      setSending(false);
    }
  };

  // Build a chronological feed: messages interleaved with artifacts that
  // share their message_id (so each AI turn's deliverable lives with it).
  const feed = buildFeed(messages, artifacts);

  return (
    <div className="flex flex-col h-full">
      {showHeader && thread && (
        <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{thread.goal ?? thread.title}</div>
            {thread.task_status && (
              <Badge variant="outline" className="mt-1 text-[10px]">{STATUS_LABEL[thread.task_status] ?? thread.task_status}</Badge>
            )}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading && messages.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">Loading thread…</div>
        )}
        {feed.map((entry) => entry.kind === 'message' ? (
          <MessageRow key={`m-${entry.message.id}`} message={entry.message} latestArtifactId={latestArtifact?.id ?? null} artifacts={entry.artifacts} />
        ) : (
          <div key={`a-${entry.artifact.id}`} className="pl-10">
            <ArtifactRenderer artifact={entry.artifact} isLatest={entry.artifact.id === latestArtifact?.id} />
          </div>
        ))}
        {feed.length === 0 && !loading && (
          <div className="text-sm text-muted-foreground text-center py-8">
            No messages yet. Send a follow-up to get started.
          </div>
        )}
      </div>

      <div className="border-t border-border/30 p-3 bg-background/60 backdrop-blur-md">
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Follow up — ask for a revision, change tone, add detail…"
            className="min-h-[44px] max-h-32 resize-none bg-muted/30"
            disabled={sending}
          />
          <Button onClick={send} disabled={!input.trim() || sending} size="icon" className="h-11 w-11 flex-shrink-0">
            {sending ? <Sparkles className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

type FeedEntry =
  | { kind: 'message'; message: ReturnType<typeof useThread>['messages'][number]; artifacts: ReturnType<typeof useThread>['artifacts'] }
  | { kind: 'artifact'; artifact: ReturnType<typeof useThread>['artifacts'][number] };

function buildFeed(messages: ReturnType<typeof useThread>['messages'], artifacts: ReturnType<typeof useThread>['artifacts']): FeedEntry[] {
  const orphanArtifacts = artifacts.filter((a) => !a.message_id || !messages.some((m) => m.id === a.message_id));
  const out: FeedEntry[] = [];
  for (const m of messages) {
    const linked = artifacts.filter((a) => a.message_id === m.id);
    out.push({ kind: 'message', message: m, artifacts: linked });
    for (const a of linked) out.push({ kind: 'artifact', artifact: a });
  }
  // Orphan artifacts (no linked message) get appended at end
  for (const a of orphanArtifacts) out.push({ kind: 'artifact', artifact: a });
  return out;
}

function MessageRow({ message, latestArtifactId, artifacts }: { message: ReturnType<typeof useThread>['messages'][number]; latestArtifactId: string | null; artifacts: ReturnType<typeof useThread>['artifacts'] }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && <div className="flex-shrink-0 mt-1"><AIOrb breatheIn /></div>}
      <div className={cn("max-w-[80%]", isUser && "items-end")}>
        <div className={cn(
          "px-4 py-3 rounded-2xl text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-card/60 backdrop-blur-md border border-border/30 rounded-bl-md"
        )}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || '…'}</ReactMarkdown>
            </div>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground/60 mt-1 px-2">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
