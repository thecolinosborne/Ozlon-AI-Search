import { useState, useCallback } from 'react';
import { Plus, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VideoTaskCard } from './VideoTaskCard';
import { VideoTaskCreateForm } from './VideoTaskCreateForm';
import { VideoTaskDetail } from './VideoTaskDetail';
import { useVideoTasks } from '@/hooks/useVideoTasks';
import type { VideoTaskWithParent, RenderStatus } from '@/types/video';

type FilterTab = 'all' | RenderStatus;

export function VideoStudioDashboard() {
  const { videoTasks, loading, createVideoTask, updateVideoTask, generateMockEditPlan } = useVideoTasks();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<VideoTaskWithParent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const filtered = filter === 'all'
    ? videoTasks
    : videoTasks.filter(t => t.render_status === filter);

  const handleTaskClick = useCallback((task: VideoTaskWithParent) => {
    setSelectedTask(task);
    setDetailOpen(true);
  }, []);

  const handleUpdate = useCallback((id: string, updates: Partial<VideoTaskWithParent>) => {
    updateVideoTask(id, updates);
    setSelectedTask(prev => prev?.id === id ? { ...prev, ...updates } as VideoTaskWithParent : prev);
  }, [updateVideoTask]);

  const counts = {
    all: videoTasks.length,
    pending: videoTasks.filter(t => t.render_status === 'pending').length,
    queued: videoTasks.filter(t => t.render_status === 'queued').length,
    rendering: videoTasks.filter(t => t.render_status === 'rendering').length,
    completed: videoTasks.filter(t => t.render_status === 'completed').length,
    failed: videoTasks.filter(t => t.render_status === 'failed').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Video Studio</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Video
        </Button>
      </div>

      <Tabs value={filter} onValueChange={v => setFilter(v as FilterTab)}>
        <TabsList className="h-8">
          {(['all', 'pending', 'queued', 'rendering', 'completed', 'failed'] as FilterTab[]).map(tab => (
            <TabsTrigger key={tab} value={tab} className="text-xs px-3 h-7 capitalize">
              {tab} {counts[tab] > 0 && `(${counts[tab]})`}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Film className="w-10 h-10 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {videoTasks.length === 0
              ? 'No video tasks yet. Create one to get started.'
              : 'No tasks match this filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(task => (
            <VideoTaskCard key={task.id} task={task} onClick={handleTaskClick} />
          ))}
        </div>
      )}

      <VideoTaskCreateForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createVideoTask}
      />

      <VideoTaskDetail
        task={selectedTask}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUpdate={handleUpdate}
        onGenerateEditPlan={generateMockEditPlan}
      />
    </div>
  );
}
