import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskType = 'general' | 'email' | 'research' | 'content' | 'outreach' | 'ops' | 'creative';
export type IntentType = 'ops' | 'lead_gen' | 'fulfillment' | 'content' | 'research' | 'outreach' | 'admin';
export type NextAction = 'waiting_on_ai' | 'waiting_on_human' | 'ready_to_send' | 'needs_review' | 'blocked' | 'none';
export type AIStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';

export interface AIActivityEntry {
  timestamp: string;
  action: string;
  detail: string;
  actor: string;
  status?: string;
}

export interface CommentEntry {
  id: string;
  timestamp: string;
  author: string;
  content: string;
}

export interface WorkTask {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  task_type: TaskType;
  intent_type: IntentType;
  assigned_to: string | null;
  next_action: NextAction;
  ai_status: AIStatus;
  board_position: number;
  draft_output: string | null;
  revision_notes: string | null;
  final_deliverable: string | null;
  ai_activity_log: AIActivityEntry[];
  comments: CommentEntry[];
  attachments: unknown[];
  source_chat_session_id: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  completed_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  last_message_preview?: string | null;
}

// ── Constants ──────────────────────────────────────────────────────

export const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'Working',
  done: 'Done',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: 'text-muted-foreground',
  in_progress: 'text-primary',
  done: 'text-green-500',
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-muted',
  medium: 'bg-primary/20',
  high: 'bg-warning/20',
  urgent: 'bg-destructive/20',
};

// Map any legacy status values arriving from the DB into the new 3-state system.
function normalizeStatus(raw: string | null | undefined): TaskStatus {
  if (raw === 'completed' || raw === 'done') return 'done';
  if (raw === 'todo') return 'todo';
  return 'in_progress'; // covers in_progress, up_for_review, awaiting_user, etc.
}

function normalizeTask(row: Record<string, unknown>): WorkTask {
  return {
    ...(row as unknown as WorkTask),
    status: normalizeStatus((row as { status?: string }).status),
  };
}

// ── Hook ───────────────────────────────────────────────────────────

interface UseWorkTasksOptions {
  trash?: boolean; // when true, only returns soft-deleted tasks
}

export function useWorkTasks(options: UseWorkTasksOptions = {}) {
  const { trash = false } = options;
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const fetchIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const fetchTasks = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const thisId = ++fetchIdRef.current;

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      let query = supabase
        .from('work_tasks')
        .select('*')
        .is('archived_at', null);

      query = trash
        ? query.not('deleted_at', 'is', null)
        : query.is('deleted_at', null);

      const { data, error: queryError } = await query
        .order('last_activity_at', { ascending: false })
        .abortSignal(controller.signal);

      clearTimeout(timeout);
      if (!mountedRef.current || thisId !== fetchIdRef.current) return;

      if (queryError) {
        setError('Failed to load tasks. Please try again.');
        console.error('[useWorkTasks] query error:', queryError);
      } else {
        const rows = (data ?? []).map((r) => normalizeTask(r as Record<string, unknown>));

        // Enrich with last message preview from the linked chat session
        const ids = rows.map((r) => r.id);
        if (ids.length > 0) {
          const { data: sessions } = await supabase
            .from('chat_sessions')
            .select('id, linked_work_task_id')
            .in('linked_work_task_id', ids);
          const sessionByTask = new Map<string, string>();
          for (const s of sessions ?? []) {
            if (s.linked_work_task_id) sessionByTask.set(s.linked_work_task_id, s.id);
          }
          const sessionIds = Array.from(sessionByTask.values());
          if (sessionIds.length > 0) {
            const { data: msgs } = await supabase
              .from('chat_messages')
              .select('session_id, content, created_at')
              .in('session_id', sessionIds)
              .order('created_at', { ascending: false });
            const previewBySession = new Map<string, string>();
            for (const m of msgs ?? []) {
              if (!previewBySession.has(m.session_id)) {
                previewBySession.set(m.session_id, m.content);
              }
            }
            for (const r of rows) {
              const sid = sessionByTask.get(r.id);
              r.last_message_preview = sid ? (previewBySession.get(sid) ?? null) : null;
            }
          }
        }

        setTasks(rows);
        setError(null);
      }
    } catch (e: unknown) {
      clearTimeout(timeout);
      if (!mountedRef.current || thisId !== fetchIdRef.current) return;
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError('Failed to load tasks. Please try again.');
      console.error('[useWorkTasks] fetch exception:', e);
    } finally {
      if (mountedRef.current && thisId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [trash]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Realtime updates on work_tasks
  useEffect(() => {
    const channel = supabase
      .channel(`work_tasks_changes_${trash ? 'trash' : 'live'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_tasks' },
        (payload) => {
          if (!mountedRef.current) return;
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id?: string };
            if (oldRow?.id) setTasks((prev) => prev.filter((t) => t.id !== oldRow.id));
            return;
          }
          const row = normalizeTask(payload.new as Record<string, unknown>);
          const isInTrash = !!row.deleted_at;
          // If row no longer belongs in this view, drop it
          if (trash !== isInTrash) {
            setTasks((prev) => prev.filter((t) => t.id !== row.id));
            return;
          }
          if (payload.eventType === 'INSERT') {
            setTasks((prev) => (prev.some((t) => t.id === row.id) ? prev : [row, ...prev]));
          } else {
            setTasks((prev) => {
              const existing = prev.find((t) => t.id === row.id);
              const merged = existing ? { ...existing, ...row } : row;
              return prev.some((t) => t.id === row.id)
                ? prev.map((t) => (t.id === row.id ? merged : t))
                : [merged, ...prev];
            });
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [trash]);

  const runTaskWithAI = useCallback(async (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ai_status: 'executing' as AIStatus, status: 'in_progress' as TaskStatus } : t)),
    );
    const { data, error: invokeErr } = await supabase.functions.invoke('execute-task', {
      body: { task_id: id },
    });
    if (invokeErr || !data?.success) {
      const msg = invokeErr?.message || data?.error || 'Unknown error';
      toast.error(`AI run failed: ${msg}`);
      return false;
    }
    return true;
  }, []);

  const createTask = useCallback(async (input: Partial<WorkTask>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? '00000000-0000-0000-0000-000000000000';

    const insertData = {
      user_id: userId,
      title: input.title || 'Untitled Task',
      description: input.description ?? null,
      status: normalizeStatus(input.status) || 'todo',
      priority: input.priority || 'medium',
      task_type: input.task_type || 'general',
      intent_type: input.intent_type || 'ops',
      assigned_to: input.assigned_to || 'ai',
      next_action: input.next_action || 'waiting_on_ai',
      board_position: 0,
    };

    const { data, error: err } = await supabase
      .from('work_tasks')
      .insert(insertData)
      .select()
      .single();

    if (err || !data) {
      toast.error('Failed to create task');
      console.error('[useWorkTasks] create error:', err);
      return undefined;
    }

    const created = normalizeTask(data as Record<string, unknown>);
    if (mountedRef.current) setTasks((prev) => [created, ...prev]);
    return created;
  }, []);

  const updateTask = useCallback(async (id: string, updates: Partial<WorkTask>) => {
    const normalizedUpdates: Partial<WorkTask> = updates.status
      ? { ...updates, status: normalizeStatus(updates.status as string) }
      : updates;

    let snapshot: WorkTask[] = [];
    setTasks((prev) => {
      snapshot = prev;
      const now = new Date().toISOString();
      return prev.map((t) => (t.id === id ? { ...t, ...normalizedUpdates, last_activity_at: now } : t));
    });

    const now = new Date().toISOString();
    const { error: err } = await supabase
      .from('work_tasks')
      .update({ ...normalizedUpdates, last_activity_at: now } as never)
      .eq('id', id);

    if (err) {
      toast.error('Failed to update task');
      console.error('[useWorkTasks] update error:', err);
      if (mountedRef.current) setTasks(snapshot);
    }
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    let snapshot: WorkTask[] = [];
    setTasks((prev) => { snapshot = prev; return prev.filter((t) => t.id !== id); });

    const { error: err } = await supabase.from('work_tasks').delete().eq('id', id);

    if (err) {
      toast.error('Failed to delete task');
      console.error('[useWorkTasks] delete error:', err);
      if (mountedRef.current) setTasks(snapshot);
      return;
    }
    toast.success('Task deleted');
  }, []);

  const archiveTask = useCallback(async (id: string) => {
    let snapshot: WorkTask[] = [];
    setTasks((prev) => { snapshot = prev; return prev.filter((t) => t.id !== id); });

    const { error: err } = await supabase
      .from('work_tasks')
      .update({ archived_at: new Date().toISOString() } as never)
      .eq('id', id);

    if (err) {
      toast.error('Failed to archive task');
      if (mountedRef.current) setTasks(snapshot);
      return;
    }
    toast.success('Task archived');
  }, []);

  const unarchiveTask = useCallback(async (id: string) => {
    const { error: err } = await supabase
      .from('work_tasks')
      .update({ archived_at: null } as never)
      .eq('id', id);
    if (err) { toast.error('Failed to unarchive task'); return; }
    await fetchTasks();
    toast.success('Task restored');
  }, [fetchTasks]);

  /**
   * Mark a task done AND soft-delete its paired thread. Items live in trash
   * for 30 days before automatic purge.
   */
  const markDone = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    let snapshot: WorkTask[] = [];
    setTasks((prev) => { snapshot = prev; return prev.filter((t) => t.id !== id); });

    const { error: err } = await supabase
      .from('work_tasks')
      .update({
        status: 'done',
        ai_status: 'idle',
        next_action: 'none',
        completed_at: now,
        deleted_at: now,
        last_activity_at: now,
      } as never)
      .eq('id', id);

    if (err) {
      toast.error('Could not mark done');
      if (mountedRef.current) setTasks(snapshot);
      return false;
    }

    // Soft-delete linked chat session(s) so they vanish from chat history too
    await supabase
      .from('chat_sessions')
      .update({ deleted_at: now } as never)
      .eq('linked_work_task_id', id);

    toast.success('Marked done — moved to trash for 30 days');
    return true;
  }, []);

  /**
   * Soft-delete a task without changing its status. Sends to trash for 30 days.
   * Same trash mechanism as markDone, but preserves the task's status so
   * restoring puts it back in the right column.
   */
  const softDelete = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    let snapshot: WorkTask[] = [];
    setTasks((prev) => { snapshot = prev; return prev.filter((t) => t.id !== id); });

    const { error: err } = await supabase
      .from('work_tasks')
      .update({ deleted_at: now, last_activity_at: now } as never)
      .eq('id', id);

    if (err) {
      toast.error('Could not delete');
      if (mountedRef.current) setTasks(snapshot);
      return false;
    }

    await supabase
      .from('chat_sessions')
      .update({ deleted_at: now } as never)
      .eq('linked_work_task_id', id);

    toast.success('Moved to trash — recoverable for 30 days');
    return true;
  }, []);

  const restoreFromTrash = useCallback(async (id: string) => {
    const { error: err } = await supabase
      .from('work_tasks')
      .update({ deleted_at: null } as never)
      .eq('id', id);
    if (err) { toast.error('Could not restore'); return; }
    await supabase
      .from('chat_sessions')
      .update({ deleted_at: null } as never)
      .eq('linked_work_task_id', id);
    if (mountedRef.current) setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success('Restored');
  }, []);

  const purgeNow = useCallback(async (id: string) => {
    const { error: err } = await supabase.from('work_tasks').delete().eq('id', id);
    if (err) { toast.error('Could not delete'); return; }
    if (mountedRef.current) setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success('Deleted permanently');
  }, []);

  return {
    tasks,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    archiveTask,
    unarchiveTask,
    runTaskWithAI,
    markDone,
    softDelete,
    restoreFromTrash,
    purgeNow,
  };
}
