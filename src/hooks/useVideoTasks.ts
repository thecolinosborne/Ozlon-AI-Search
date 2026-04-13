import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { VideoTask, VideoTaskWithParent, EditPlanAction } from '@/types/video';

export function useVideoTasks() {
  const { session } = useAuth();
  const [videoTasks, setVideoTasks] = useState<VideoTaskWithParent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVideoTasks = useCallback(async () => {
    if (!session?.user?.id) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('video_tasks')
      .select('*, work_tasks!inner(title, status, ai_status, ai_activity_log)')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch video tasks:', error);
      setLoading(false);
      return;
    }

    const mapped: VideoTaskWithParent[] = (data || []).map((row: any) => ({
      id: row.id,
      work_task_id: row.work_task_id,
      user_id: row.user_id,
      source_type: row.source_type,
      source_content: row.source_content,
      source_asset_url: row.source_asset_url,
      requested_output: row.requested_output,
      edit_instructions: row.edit_instructions,
      edit_plan: row.edit_plan as EditPlanAction[],
      edit_plan_status: row.edit_plan_status,
      aspect_ratio: row.aspect_ratio,
      target_duration: row.target_duration,
      render_status: row.render_status,
      render_progress: row.render_progress,
      output_url: row.output_url,
      thumbnail_url: row.thumbnail_url,
      render_history: row.render_history as any[],
      created_at: row.created_at,
      updated_at: row.updated_at,
      parent_title: row.work_tasks.title,
      parent_status: row.work_tasks.status,
      parent_ai_status: row.work_tasks.ai_status,
      parent_ai_activity_log: row.work_tasks.ai_activity_log as unknown[],
    }));

    setVideoTasks(mapped);
    setLoading(false);
  }, [session?.user?.id]);

  useEffect(() => {
    fetchVideoTasks();
  }, [fetchVideoTasks]);

  const createVideoTask = useCallback(async (input: {
    title: string;
    description?: string;
    source_type: VideoTask['source_type'];
    source_content?: string;
    requested_output: VideoTask['requested_output'];
    edit_instructions?: string;
    aspect_ratio: VideoTask['aspect_ratio'];
    target_duration?: number;
  }) => {
    if (!session?.user?.id) return;

    // Create parent work_task
    const { data: parentData, error: parentError } = await supabase
      .from('work_tasks')
      .insert({
        user_id: session.user.id,
        title: input.title,
        description: input.description || null,
        task_type: 'creative',
        intent_type: 'content',
        assigned_to: 'ai',
        next_action: 'waiting_on_ai',
        status: 'todo',
        board_position: 0,
      })
      .select()
      .single();

    if (parentError) {
      toast.error('Failed to create task');
      console.error(parentError);
      return;
    }

    // Create linked video_task
    const { data: videoData, error: videoError } = await supabase
      .from('video_tasks')
      .insert({
        work_task_id: parentData.id,
        user_id: session.user.id,
        source_type: input.source_type,
        source_content: input.source_content || null,
        requested_output: input.requested_output,
        edit_instructions: input.edit_instructions || null,
        aspect_ratio: input.aspect_ratio,
        target_duration: input.target_duration || null,
      } as any)
      .select()
      .single();

    if (videoError) {
      toast.error('Failed to create video task');
      console.error(videoError);
      return;
    }

    toast.success('Video task created');
    fetchVideoTasks();
    return videoData;
  }, [session?.user?.id, fetchVideoTasks]);

  const updateVideoTask = useCallback(async (id: string, updates: Partial<VideoTask>) => {
    const { error } = await supabase
      .from('video_tasks')
      .update(updates as any)
      .eq('id', id);

    if (error) {
      toast.error('Failed to update video task');
      console.error(error);
      return;
    }

    setVideoTasks(prev => prev.map(t =>
      t.id === id ? { ...t, ...updates } as VideoTaskWithParent : t
    ));
  }, []);

  const generateMockEditPlan = useCallback((instructions: string): EditPlanAction[] => {
    const id = () => crypto.randomUUID();
    return [
      { id: id(), action_type: 'trim', label: 'Trim intro', detail: 'Remove first 3 seconds', phase: 'pre', status: 'pending' },
      { id: id(), action_type: 'caption', label: 'Add captions', detail: 'Auto-generate subtitles', phase: 'main', status: 'pending' },
      { id: id(), action_type: 'music', label: 'Add background music', detail: 'Trending audio overlay', phase: 'main', status: 'pending' },
      { id: id(), action_type: 'color', label: 'Color grade', detail: 'Apply warm tone preset', phase: 'post', status: 'pending' },
      { id: id(), action_type: 'export', label: 'Export final', detail: instructions || 'Standard export', phase: 'post', status: 'pending' },
    ];
  }, []);

  return {
    videoTasks,
    loading,
    fetchVideoTasks,
    createVideoTask,
    updateVideoTask,
    generateMockEditPlan,
  };
}
