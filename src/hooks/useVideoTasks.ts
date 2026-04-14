import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { VideoTask, VideoTaskWithParent, EditPlanAction, RenderHistoryEntry } from '@/types/video';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

/** Shape returned by the joined query: video_tasks + nested work_tasks fields */
type VideoTaskRow = Tables<'video_tasks'> & {
  work_tasks: Pick<Tables<'work_tasks'>, 'title' | 'status' | 'ai_status' | 'ai_activity_log'> | null;
};

const isDev = import.meta.env.DEV;

export function useVideoTasks() {
  const { session } = useAuth();
  const [videoTasks, setVideoTasks] = useState<VideoTaskWithParent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderingTaskId, setRenderingTaskId] = useState<string | null>(null);
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const renderInterval = useRef<number>();
  const mountedRef = useRef(true);

  // Lifecycle: track mounted state, clean up render interval
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (renderInterval.current) {
        clearInterval(renderInterval.current);
        renderInterval.current = undefined;
      }
    };
  }, []);

  const fetchVideoTasks = useCallback(async () => {
    if (!session?.user?.id) {
      if (mountedRef.current) {
        setLoading(false);
        setError(null);
      }
      return;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      // Add timeout to prevent infinite loading
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const { data, error: queryError } = await supabase
        .from('video_tasks')
        .select('*, work_tasks!inner(title, status, ai_status, ai_activity_log)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .abortSignal(controller.signal);

      clearTimeout(timeout);

      if (!mountedRef.current) return;

      if (queryError) {
        console.error('Failed to fetch video tasks:', queryError);
        setError('Failed to load video tasks');
        setLoading(false);
        return;
      }

      const mapped: VideoTaskWithParent[] = (data as VideoTaskRow[] || []).map((row) => ({
        id: row.id,
        work_task_id: row.work_task_id,
        user_id: row.user_id,
        source_type: row.source_type as VideoTask['source_type'],
        source_content: row.source_content,
        source_asset_url: row.source_asset_url,
        requested_output: row.requested_output as VideoTask['requested_output'],
        edit_instructions: row.edit_instructions,
        edit_plan: row.edit_plan as unknown as EditPlanAction[],
        edit_plan_status: row.edit_plan_status as VideoTask['edit_plan_status'],
        aspect_ratio: row.aspect_ratio as VideoTask['aspect_ratio'],
        target_duration: row.target_duration,
        render_status: row.render_status as VideoTask['render_status'],
        render_progress: row.render_progress,
        output_url: row.output_url,
        thumbnail_url: row.thumbnail_url,
        render_history: row.render_history as unknown as RenderHistoryEntry[],
        created_at: row.created_at,
        updated_at: row.updated_at,
        parent_title: row.work_tasks?.title ?? 'Untitled',
        parent_status: row.work_tasks?.status ?? 'todo',
        parent_ai_status: row.work_tasks?.ai_status ?? 'idle',
        parent_ai_activity_log: (row.work_tasks?.ai_activity_log as unknown[]) ?? [],
      }));

      setVideoTasks(mapped);
      setLoading(false);
    } catch (e) {
      console.error('useVideoTasks fetch exception:', e);
      if (mountedRef.current) {
        setError('Failed to load video tasks');
        setLoading(false);
      }
    }
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
      } satisfies TablesInsert<'video_tasks'>)
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
    const { edit_plan, render_history, ...rest } = updates;
    const dbUpdates: TablesUpdate<'video_tasks'> = {
      ...rest,
      ...(edit_plan !== undefined && { edit_plan: edit_plan as unknown as TablesUpdate<'video_tasks'>['edit_plan'] }),
      ...(render_history !== undefined && { render_history: render_history as unknown as TablesUpdate<'video_tasks'>['render_history'] }),
    };
    const { error } = await supabase
      .from('video_tasks')
      .update(dbUpdates)
      .eq('id', id);

    if (error) {
      toast.error('Failed to update video task');
      console.error(error);
      return;
    }

    if (mountedRef.current) {
      setVideoTasks(prev => prev.map(t =>
        t.id === id ? { ...t, ...updates } as VideoTaskWithParent : t
      ));
    }
  }, []);

  const generateEditPlan = useCallback(async (taskId: string) => {
    toast.info('Generating edit plan...');

    const { data, error } = await supabase.functions.invoke('render-video', {
      body: { action: 'generate_plan', video_task_id: taskId },
    });

    if (error || data?.error) {
      toast.error(data?.error || 'Failed to generate edit plan');
      console.error('generate_plan error:', error || data?.error);
      return;
    }

    if (mountedRef.current) {
      setVideoTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, edit_plan: data.plan, edit_plan_status: 'generated' } as VideoTaskWithParent
          : t
      ));
    }

    toast.success('Edit plan generated');
    return data.plan as EditPlanAction[];
  }, []);

  const startRender = useCallback(async (taskId: string) => {
    const { data, error } = await supabase.functions.invoke('render-video', {
      body: { action: 'start_render', video_task_id: taskId },
    });

    if (error || data?.error) {
      toast.error(data?.error || 'Failed to start render');
      console.error('start_render error:', error || data?.error);
      return;
    }

    if (!mountedRef.current) return;

    setRenderingTaskId(taskId);
    setSimulatedProgress(0);
    setVideoTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, render_status: 'rendering', render_progress: 0 } as VideoTaskWithParent
        : t
    ));

    toast.info('Render started');

    let progress = 0;
    if (renderInterval.current) clearInterval(renderInterval.current);

    renderInterval.current = window.setInterval(async () => {
      if (!mountedRef.current) {
        clearInterval(renderInterval.current);
        renderInterval.current = undefined;
        return;
      }

      progress += 25;
      setSimulatedProgress(progress);

      if (progress >= 100) {
        clearInterval(renderInterval.current);
        renderInterval.current = undefined;

        const { data: completeData, error: completeErr } = await supabase.functions.invoke('render-video', {
          body: { action: 'complete_render', video_task_id: taskId },
        });

        if (!mountedRef.current) return;

        if (completeErr || completeData?.error) {
          toast.error('Render failed');
          setRenderingTaskId(null);
          setSimulatedProgress(0);
          fetchVideoTasks();
          return;
        }

        toast.success('Render completed');
        setRenderingTaskId(null);
        setSimulatedProgress(0);
        fetchVideoTasks();
      }
    }, 2000);
  }, [fetchVideoTasks]);

  return {
    videoTasks,
    loading,
    error,
    renderingTaskId,
    simulatedProgress,
    fetchVideoTasks,
    createVideoTask,
    updateVideoTask,
    generateEditPlan,
    startRender,
  };
}
