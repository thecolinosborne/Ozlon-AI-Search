// Shared thread surface: chat history with inline artifacts + composer.
// Streams via the same /chat edge function the main chat uses, so all tools,
// integrations, model routing, and the Infinity Router are available in-task.
// After streaming completes, we persist the assistant message and call
// execute-task in finalize_only mode to extract a typed artifact.

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { streamChat, UserSettings, Message } from '@/services/chatService';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/stores/useAppStore';
import { toast } from 'sonner';

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
  const { thread, messages, artifacts, latestArtifact, loading, refresh } = useThread(threadId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { systemName } = useAuth();
  const { user: storeUser, connections, agents } = useAppStore();

  const userSettings: UserSettings = useMemo(() => ({
    communicationMode: storeUser?.communicationMode || 'both',
    integrations: {
      calendar: connections.find((c) => c.id === 'calendar')?.connected || false,
      email: connections.find((c) => c.id === 'email')?.connected || false,
      banking: connections.find((c) => c.id === 'banking')?.connected || false,
    },
    agents: {
      memory: agents.find((a) => a.id === 'memory')?.enabled || false,
      orchestration: agents.find((a) => a.id === 'orchestration')?.enabled || false,
      communication: agents.find((a) => a.id === 'communication')?.enabled || false,
      personality: agents.find((a) => a.id === 'personality')?.enabled || false,
      banking: agents.find((a) => a.id === 'banking')?.enabled || false,
      summary: agents.find((a) => a.id === 'summary')?.enabled || false,
    },
    osName: systemName,
  }), [storeUser?.communicationMode, connections, agents, systemName]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, artifacts.length, streamingContent]);

  const send = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    setStreamingContent('');

    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess?.session?.user?.id;
      if (!userId) { toast.error('Sign in required'); return; }

      // 1. Persist user message
      const { data: userMsg, error: insertErr } = await supabase.from('chat_messages').insert({
        session_id: threadId,
        user_id: userId,
        role: 'user',
        content: text,
      }).select().single();
      if (insertErr || !userMsg) { toast.error('Failed to send'); return; }

      // 2. Build message history for the AI (use freshly-loaded messages + new user msg)
      const history: Message[] = messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));
      history.push({ role: 'user', content: text });

      // 3. Stream from /chat with full tool access
      let assembled = '';
      await new Promise<void>((resolve) => {
        streamChat({
          messages: history,
          systemName,
          enableTools: true,
          userSettings,
          onDelta: (delta) => {
            assembled += delta;
            setStreamingContent(assembled);
          },
          onDone: () => resolve(),
          onError: (err) => {
            toast.error(`Chat error: ${err}`);
            resolve();
          },
        });
      });

      const finalText = assembled.trim() || '(no output)';

      // 4. Persist assistant message
      const { data: asstMsg } = await supabase.from('chat_messages').insert({
        session_id: threadId,
        user_id: userId,
        role: 'assistant',
        content: finalText,
      }).select().single();

      // 5. Ask execute-task to extract a typed artifact (no re-run of the AI)
      if (asstMsg?.id) {
        await supabase.functions.invoke('execute-task', {
          body: { thread_id: threadId, finalize_only: true, assistant_message_id: asstMsg.id },
        });
      }

      // 6. Clear streaming bubble — realtime will surface the persisted rows
      setStreamingContent('');
      // Safety: pull latest in case realtime missed
      refresh();
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
          <MessageRow key={`m-${entry.message.id}`} message={entry.message} />
        ) : (
          <div key={`a-${entry.artifact.id}`} className="pl-10">
            <ArtifactRenderer artifact={entry.artifact} isLatest={entry.artifact.id === latestArtifact?.id} />
          </div>
        ))}
        {streamingContent && (
          <StreamingRow content={streamingContent} />
        )}
        {feed.length === 0 && !loading && !streamingContent && (
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
  | { kind: 'message'; message: ReturnType<typeof useThread>['messages'][number] }
  | { kind: 'artifact'; artifact: ReturnType<typeof useThread>['artifacts'][number] };

function buildFeed(messages: ReturnType<typeof useThread>['messages'], artifacts: ReturnType<typeof useThread>['artifacts']): FeedEntry[] {
  const orphanArtifacts = artifacts.filter((a) => !a.message_id || !messages.some((m) => m.id === a.message_id));
  const out: FeedEntry[] = [];
  for (const m of messages) {
    out.push({ kind: 'message', message: m });
    const linked = artifacts.filter((a) => a.message_id === m.id);
    for (const a of linked) out.push({ kind: 'artifact', artifact: a });
  }
  for (const a of orphanArtifacts) out.push({ kind: 'artifact', artifact: a });
  return out;
}

function MessageRow({ message }: { message: ReturnType<typeof useThread>['messages'][number] }) {
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

function StreamingRow({ content }: { content: string }) {
  return (
    <div className="flex gap-3 justify-start">
      <div className="flex-shrink-0 mt-1"><AIOrb breatheIn /></div>
      <div className="max-w-[80%]">
        <div className="px-4 py-3 rounded-2xl rounded-bl-md text-sm leading-relaxed bg-card/60 backdrop-blur-md border border-border/30">
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
