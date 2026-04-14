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

export function useWorkTasks() {
  const { session, authLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for safe async handling
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

  // ── Fetch ──

  const fetchTasks = useCallback(async () => {
    if (!userId) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const thisId = ++fetchIdRef.current;

    setLoading(true);
    setError(null);

    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const { data, error: qErr } = await supabase
        .from('work_tasks')
        .select('*')
        .eq('user_id', userId)
        .is('archived_at', null)
        .order('last_activity_at', { ascending: false })
        .abortSignal(controller.signal);

      clearTimeout(timeout);
      if (!mountedRef.current || thisId !== fetchIdRef.current) return;

      if (qErr) {
        setError('Failed to load tasks. Please try again.');
        console.error('useWorkTasks query error:', qErr);
      } else {
        setTasks((data ?? []) as unknown as WorkTask[]);
        setError(null);
      }
    } catch (e: unknown) {
      clearTimeout(timeout);
      if (!mountedRef.current || thisId !== fetchIdRef.current) return;
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError('Failed to load tasks. Please try again.');
      console.error('useWorkTasks fetch exception:', e);
    } finally {
      if (mountedRef.current && thisId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [userId]);

  // ── Auto-fetch effect: gated on auth readiness ──

  useEffect(() => {
    if (authLoading) return; // wait for auth to resolve
    if (!userId) {
      // Auth resolved, no user — clear and settle
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }
    fetchTasks();
  }, [authLoading, userId, fetchTasks]);

  // ── Create ──

  const createTask = useCallback(async (task: Partial<WorkTask>) => {
    if (!userId) return;

    const targetStatus = task.status || 'todo';
    const maxPos = tasks
      .filter(t => t.status === targetStatus)
      .reduce((max, t) => Math.max(max, t.board_position), -1);

    const insertData = {
      user_id: userId,
      title: task.title || 'Untitled Task',
      description: task.description || null,
      status: targetStatus,
      priority: task.priority || 'medium',
      task_type: task.task_type || 'general',
      intent_type: task.intent_type || 'ops',
      assigned_to: task.assigned_to || 'ai',
      next_action: task.next_action || 'waiting_on_ai',
      board_position: maxPos + 1,
    };

    const { data, error: insertError } = await supabase
      .from('work_tasks')
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      toast.error('Failed to create task');
      console.error(insertError);
      return;
    }

    const newTask = data as unknown as WorkTask;
    if (mountedRef.current) {
      setTasks(prev => [newTask, ...prev]);
    }
    toast.success('Task created');
    return newTask;
  }, [userId, tasks]);

  // ── Update (optimistic) ──

  const updateTask = useCallback(async (id: string, updates: Partial<WorkTask>) => {
    const snapshot = tasks;
    const now = new Date().toISOString();

    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates, last_activity_at: now } : t));

    const { error: updateError } = await supabase
      .from('work_tasks')
      .update({ ...updates, last_activity_at: now } as never)
      .eq('id', id);

    if (updateError) {
      toast.error('Failed to update task');
      console.error(updateError);
      if (mountedRef.current) setTasks(snapshot);
    }
  }, [tasks]);

  // ── Archive (optimistic) ──

  const archiveTask = useCallback(async (id: string) => {
    const snapshot = tasks;
    setTasks(prev => prev.filter(t => t.id !== id));

    const { error: archiveError } = await supabase
      .from('work_tasks')
      .update({ archived_at: new Date().toISOString() } as never)
      .eq('id', id);

    if (archiveError) {
      toast.error('Failed to archive task');
      if (mountedRef.current) setTasks(snapshot);
      return;
    }
    toast.success('Task archived');
  }, [tasks]);

  // ── Unarchive ──

  const unarchiveTask = useCallback(async (id: string) => {
    const { error: unarchiveError } = await supabase
      .from('work_tasks')
      .update({ archived_at: null } as never)
      .eq('id', id);

    if (unarchiveError) {
      toast.error('Failed to unarchive task');
      return;
    }
    await fetchTasks();
    toast.success('Task restored');
  }, [fetchTasks]);

  // ── Derived helper ──

  const getTasksByStatus = useCallback((status: TaskStatus) => {
    return tasks
      .filter(t => t.status === status)
      .sort((a, b) => a.board_position - b.board_position);
  }, [tasks]);

  return {
    tasks,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    archiveTask,
    unarchiveTask,
    getTasksByStatus,
  };
}
