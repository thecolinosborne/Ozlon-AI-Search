import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

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

export function useWorkTasks() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data, error } = await supabase
      .from('work_tasks')
      .select('*')
      .eq('user_id', session.user.id)
      .is('archived_at', null)
      .order('last_activity_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch tasks:', error);
      return;
    }
    setTasks((data || []) as unknown as WorkTask[]);
    setLoading(false);
  }, [session?.user?.id]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = useCallback(async (task: Partial<WorkTask>) => {
    if (!session?.user?.id) return;

    // Get max board_position for the target status
    const targetStatus = task.status || 'todo';
    const maxPos = tasks
      .filter(t => t.status === targetStatus)
      .reduce((max, t) => Math.max(max, t.board_position), -1);

    const { data, error } = await supabase
      .from('work_tasks')
      .insert({
        user_id: session.user.id,
        title: task.title || 'Untitled Task',
        description: task.description || null,
        status: targetStatus,
        priority: task.priority || 'medium',
        task_type: task.task_type || 'general',
        intent_type: task.intent_type || 'ops',
        assigned_to: task.assigned_to || 'ai',
        next_action: task.next_action || 'waiting_on_ai',
        board_position: maxPos + 1,
      } as Record<string, unknown>)
      .select()
      .single();

    if (error) {
      toast.error('Failed to create task');
      console.error(error);
      return;
    }
    setTasks(prev => [data as unknown as WorkTask, ...prev]);
    toast.success('Task created');
    return data as unknown as WorkTask;
  }, [session?.user?.id, tasks]);

  const updateTask = useCallback(async (id: string, updates: Partial<WorkTask>) => {
    const { error } = await supabase
      .from('work_tasks')
      .update({
        ...updates,
        last_activity_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', id);

    if (error) {
      toast.error('Failed to update task');
      console.error(error);
      return;
    }
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates, last_activity_at: new Date().toISOString() } : t));
  }, []);

  const archiveTask = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('work_tasks')
      .update({ archived_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', id);

    if (error) {
      toast.error('Failed to archive task');
      return;
    }
    setTasks(prev => prev.filter(t => t.id !== id));
    toast.success('Task archived');
  }, []);

  const unarchiveTask = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('work_tasks')
      .update({ archived_at: null } as Record<string, unknown>)
      .eq('id', id);

    if (error) {
      toast.error('Failed to unarchive task');
      return;
    }
    fetchTasks();
    toast.success('Task restored');
  }, [fetchTasks]);

  const getTasksByStatus = useCallback((status: TaskStatus) => {
    return tasks
      .filter(t => t.status === status)
      .sort((a, b) => a.board_position - b.board_position);
  }, [tasks]);

  return {
    tasks,
    loading,
    fetchTasks,
    createTask,
    updateTask,
    archiveTask,
    unarchiveTask,
    getTasksByStatus,
  };
}
