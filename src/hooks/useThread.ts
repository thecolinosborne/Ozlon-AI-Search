// Unified thread hook: pulls messages + artifacts + task metadata for any
// chat_session, regardless of whether it's a chat, a task, or both.
// Subscribes to realtime so background AI work shows up live.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { streamChat, type Message } from '@/services/chatService';
import { toast } from 'sonner';

export type ThreadKind = 'chat' | 'task' | 'both';
export type TaskStatus = 'awaiting_user' | 'working' | 'scheduled' | 'blocked' | 'done';

export interface ThreadMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: string;
  content: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export type ArtifactType =
  | 'markdown'
  | 'email_draft'
  | 'doc_link'
  | 'image'
  | 'file'
  | 'checklist'
  | 'decision'
  | 'action_result'
  | 'plan';

export interface Artifact {
  id: string;
  user_id: string;
  conversation_id: string;
  message_id: string | null;
  version: number;
  type: ArtifactType;
  title: string | null;
  content: Record<string, unknown>;
  external_ref: Record<string, unknown>;
  status: 'draft' | 'approved' | 'published' | 'archived';
  created_by: 'ai' | 'user';
  created_at: string;
  updated_at: string;
}

export interface Thread {
  id: string;
  user_id: string;
  title: string | null;
  kind: ThreadKind;
  goal: string | null;
  task_status: TaskStatus | null;
  priority: string | null;
  current_artifact_id: string | null;
  linked_work_task_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function useThread(threadId: string | null) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    const [tRes, mRes, aRes] = await Promise.all([
      supabase.from('chat_sessions').select('*').eq('id', threadId).maybeSingle(),
      supabase.from('chat_messages').select('*').eq('session_id', threadId).order('created_at', { ascending: true }),
      supabase.from('artifacts').select('*').eq('conversation_id', threadId).order('version', { ascending: true }),
    ]);
    if (!mountedRef.current) return;
    if (tRes.data) setThread(tRes.data as unknown as Thread);
    if (mRes.data) setMessages(mRes.data as unknown as ThreadMessage[]);
    if (aRes.data) setArtifacts(aRes.data as unknown as Artifact[]);
    setLoading(false);
  }, [threadId]);

  useEffect(() => {
    if (!threadId) {
      setThread(null); setMessages([]); setArtifacts([]);
      return;
    }
    refresh();
  }, [threadId, refresh]);

  // Realtime: messages + artifacts + thread metadata for this thread only
  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`thread:${threadId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${threadId}` }, (p) => {
        if (!mountedRef.current) return;
        if (p.eventType === 'INSERT') {
          const row = p.new as unknown as ThreadMessage;
          setMessages((prev) => prev.some((m) => m.id === row.id) ? prev : [...prev, row]);
        } else if (p.eventType === 'UPDATE') {
          const row = p.new as unknown as ThreadMessage;
          setMessages((prev) => prev.map((m) => m.id === row.id ? row : m));
        } else if (p.eventType === 'DELETE') {
          const old = p.old as { id?: string };
          if (old?.id) setMessages((prev) => prev.filter((m) => m.id !== old.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artifacts', filter: `conversation_id=eq.${threadId}` }, (p) => {
        if (!mountedRef.current) return;
        if (p.eventType === 'INSERT') {
          const row = p.new as unknown as Artifact;
          setArtifacts((prev) => prev.some((a) => a.id === row.id) ? prev : [...prev, row]);
        } else if (p.eventType === 'UPDATE') {
          const row = p.new as unknown as Artifact;
          setArtifacts((prev) => prev.map((a) => a.id === row.id ? row : a));
        } else if (p.eventType === 'DELETE') {
          const old = p.old as { id?: string };
          if (old?.id) setArtifacts((prev) => prev.filter((a) => a.id !== old.id));
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_sessions', filter: `id=eq.${threadId}` }, (p) => {
        if (!mountedRef.current) return;
        setThread(p.new as unknown as Thread);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [threadId]);

  // Send a follow-up to the AI. Streams via the same /chat edge function the
  // main chat uses (full tool access, Infinity Router, model routing), then
  // calls execute-task in finalize_only mode for artifact extraction.
  const sendFollowUp = useCallback(async (content: string) => {
    if (!threadId || !content.trim()) return;
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess?.session?.user?.id;
    if (!userId) return;

    const trimmed = content.trim();

    // Persist user message
    const { error: insertErr } = await supabase.from('chat_messages').insert({
      session_id: threadId,
      user_id: userId,
      role: 'user',
      content: trimmed,
    });
    if (insertErr) { toast.error('Failed to send'); return; }

    // Build history from current messages + the new user turn
    const history: Message[] = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    history.push({ role: 'user', content: trimmed });

    // Optimistic in-flight assistant bubble
    const tempAsstId = `inflight-${crypto.randomUUID()}`;
    const startedAt = new Date().toISOString();
    setMessages((prev) => [...prev, {
      id: tempAsstId, session_id: threadId, user_id: userId,
      role: 'assistant', content: '', created_at: startedAt, metadata: { inflight: true },
    }]);

    let assembled = '';
    await new Promise<void>((resolve) => {
      streamChat({
        messages: history,
        enableTools: true,
        onDelta: (delta) => {
          assembled += delta;
          setMessages((prev) => prev.map((m) =>
            m.id === tempAsstId ? { ...m, content: assembled } : m
          ));
        },
        onDone: () => resolve(),
        onError: (err) => { toast.error(`Chat error: ${err}`); resolve(); },
      });
    });

    const finalText = assembled.trim() || '(no output)';

    // Persist assistant message; realtime will replace the optimistic bubble
    const { data: asstMsg } = await supabase.from('chat_messages').insert({
      session_id: threadId,
      user_id: userId,
      role: 'assistant',
      content: finalText,
    }).select().single();

    // Drop the optimistic bubble (real one arrives via realtime)
    setMessages((prev) => prev.filter((m) => m.id !== tempAsstId));

    // Extract artifact from the just-saved assistant message
    if (asstMsg?.id) {
      supabase.functions.invoke('execute-task', {
        body: { thread_id: threadId, finalize_only: true, assistant_message_id: asstMsg.id },
      }).catch((e) => console.warn('[useThread] finalize_only failed:', e));
    }
  }, [threadId, messages]);

  const latestArtifact = artifacts.length > 0
    ? [...artifacts].sort((a, b) => b.version - a.version)[0]
    : null;

  return { thread, messages, artifacts, latestArtifact, loading, refresh, sendFollowUp };
}
