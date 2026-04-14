import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'up_for_review' | 'completed';
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
}

// ── Constants ──────────────────────────────────────────────────────

export const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'up_for_review', 'completed'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  up_for_review: 'Review',
  completed: 'Completed',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: 'text-muted-foreground',
  in_progress: 'text-primary',
  up_for_review: 'text-warning',
  completed: 'text-green-500',
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-muted',
  medium: 'bg-primary/20',
  high: 'bg-warning/20',
  urgent: 'bg-destructive/20',
};

// ── Hook ───────────────────────────────────────────────────────────

/**
 * Reliable data hook for work_tasks.
 *
 * Contract:
 *  - Does NOT fetch until authLoading is false and a userId is present.
 *  - If auth resolves with no user, settles immediately (tasks=[], loading=false, error=null).
 *  - loading starts false; set true only when an actual fetch begins.
 *  - loading always resets in finally, even on abort/error.
 *  - error is set on failure and cleared on success or new fetch start.
 *  - Stale responses (from prior fetches or unmounted components) are discarded.
 *  - Optimistic mutations roll back on failure.
 *  - fetchTasks is stable and safe to call as a retry at any time.
 */
export function useWorkTasks() {
  const { session, authLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Async safety refs ──
  const mountedRef = useRef(true);
  const fetchIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Track mount/unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // ── Fetch ──
  const fetchTasks = useCallback(async () => {
    if (!userId) return;

    // Cancel previous in-flight request
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
      const { data, error: queryError } = await supabase
        .from('work_tasks')
        .select('*')
        .eq('user_id', userId)
        .is('archived_at', null)
        .order('last_activity_at', { ascending: false })
        .abortSignal(controller.signal);

      clearTimeout(timeout);

      // Discard stale response
      if (!mountedRef.current || thisId !== fetchIdRef.current) return;

      if (queryError) {
        setError('Failed to load tasks. Please try again.');
        console.error('[useWorkTasks] query error:', queryError);
      } else {
        setTasks((data ?? []) as unknown as WorkTask[]);
        setError(null);
      }
    } catch (e: unknown) {
      clearTimeout(timeout);
      if (!mountedRef.current || thisId !== fetchIdRef.current) return;

      // Aborts are not user-facing errors
      if (e instanceof DOMException && e.name === 'AbortError') return;

      setError('Failed to load tasks. Please try again.');
      console.error('[useWorkTasks] fetch exception:', e);
    } finally {
      if (mountedRef.current && thisId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [userId]);

  // ── Auto-fetch, gated on auth ──
  useEffect(() => {
    if (authLoading) return;

    if (!userId) {
      // Auth resolved, no user — settle immediately
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }

    fetchTasks();
  }, [authLoading, userId, fetchTasks]);

  // ── Create ──
  const createTask = useCallback(async (input: Partial<WorkTask>) => {
    if (!userId) return undefined;

    const insertData = {
      user_id: userId,
      title: input.title || 'Untitled Task',
      description: input.description ?? null,
      status: input.status || 'todo',
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

    const created = data as unknown as WorkTask;
    if (mountedRef.current) {
      setTasks(prev => [created, ...prev]);
    }
    toast.success('Task created');
    return created;
  }, [userId]);

  // ── Update (optimistic) ──
  const updateTask = useCallback(async (id: string, updates: Partial<WorkTask>) => {
    // Capture snapshot via functional setter to avoid stale closure
    let snapshot: WorkTask[] = [];
    setTasks(prev => {
      snapshot = prev;
      const now = new Date().toISOString();
      return prev.map(t => (t.id === id ? { ...t, ...updates, last_activity_at: now } : t));
    });

    const now = new Date().toISOString();
    const { error: err } = await supabase
      .from('work_tasks')
      .update({ ...updates, last_activity_at: now } as never)
      .eq('id', id);

    if (err) {
      toast.error('Failed to update task');
      console.error('[useWorkTasks] update error:', err);
      if (mountedRef.current) setTasks(snapshot);
    }
  }, []);

  // ── Delete ──
  const deleteTask = useCallback(async (id: string) => {
    let snapshot: WorkTask[] = [];
    setTasks(prev => {
      snapshot = prev;
      return prev.filter(t => t.id !== id);
    });

    const { error: err } = await supabase
      .from('work_tasks')
      .delete()
      .eq('id', id);

    if (err) {
      toast.error('Failed to delete task');
      console.error('[useWorkTasks] delete error:', err);
      if (mountedRef.current) setTasks(snapshot);
      return;
    }
    toast.success('Task deleted');
  }, []);

  // ── Archive (optimistic) ──
  const archiveTask = useCallback(async (id: string) => {
    let snapshot: WorkTask[] = [];
    setTasks(prev => {
      snapshot = prev;
      return prev.filter(t => t.id !== id);
    });

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

  // ── Unarchive ──
  const unarchiveTask = useCallback(async (id: string) => {
    const { error: err } = await supabase
      .from('work_tasks')
      .update({ archived_at: null } as never)
      .eq('id', id);

    if (err) {
      toast.error('Failed to unarchive task');
      return;
    }
    await fetchTasks();
    toast.success('Task restored');
  }, [fetchTasks]);

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
  };
}
