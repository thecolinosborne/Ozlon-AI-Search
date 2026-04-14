import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkTasks, WorkTask, TaskStatus } from '@/hooks/useWorkTasks';
import { TasksSidebar, TaskView } from '@/components/tasks/TasksSidebar';
import { TasksOverview } from '@/components/tasks/TasksOverview';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import { TaskCard } from '@/components/tasks/TaskCard';
import { TaskDetail } from '@/components/tasks/TaskDetail';
import { TaskCreateForm } from '@/components/tasks/TaskCreateForm';
import { Plus, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const Tasks = () => {
  const navigate = useNavigate();
  const { authLoading, session } = useAuth();
  const { tasks, loading, createTask, updateTask, archiveTask, unarchiveTask } = useWorkTasks();

  const [activeView, setActiveView] = useState<TaskView>('overview');
  const [selectedTask, setSelectedTask] = useState<WorkTask | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !session) navigate('/auth');
  }, [authLoading, session, navigate]);

  const handleTaskClick = useCallback((task: WorkTask) => {
    setSelectedTask(task);
    setDetailOpen(true);
  }, []);

  const handleMoveTask = useCallback((taskId: string, newStatus: TaskStatus, newPosition: number) => {
    updateTask(taskId, { status: newStatus, board_position: newPosition });
  }, [updateTask]);

  const handleUpdate = useCallback((id: string, updates: Partial<WorkTask>) => {
    updateTask(id, updates);
    setSelectedTask(prev => prev?.id === id ? { ...prev, ...updates } as WorkTask : prev);
  }, [updateTask]);

  const counts: Record<string, number> = {
    active: tasks.filter(t => t.status === 'in_progress').length,
    review: tasks.filter(t => t.status === 'up_for_review').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    activity: tasks.length,
  };

  const filteredTasks = (() => {
    switch (activeView) {
      case 'active': return tasks.filter(t => t.status === 'in_progress');
      case 'review': return tasks.filter(t => t.status === 'up_for_review');
      case 'completed': return tasks.filter(t => t.status === 'completed');
      default: return tasks;
    }
  })();

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30 px-4 py-3">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-muted/50"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" />
            New Task
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4 flex gap-6">
        {/* Sidebar */}
        <div className={cn(
          'w-48 shrink-0 transition-all duration-200',
          'hidden lg:block',
          sidebarOpen && 'block fixed inset-0 z-50 bg-background p-4 lg:relative lg:inset-auto lg:p-0 lg:z-auto'
        )}>
          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden mb-4 text-sm text-muted-foreground"
            >
              ← Close
            </button>
          )}
          <TasksSidebar
            activeView={activeView}
            onViewChange={(v) => {
              setActiveView(v);
              setSidebarOpen(false);
            }}
            counts={counts}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {activeView === 'overview' && (
            tasks.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <p className="text-lg font-medium text-foreground">No tasks yet</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Tasks created from chat or manually will appear here. This is your persistent task board — not live activity.
                </p>
                <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 mt-4">
                  <Plus className="w-4 h-4" />
                  Create your first task
                </Button>
              </div>
            ) : (
              <TasksOverview tasks={tasks} onTaskClick={handleTaskClick} />
            )
          )}
          {activeView === 'board' && (
            <TaskBoard tasks={tasks} onTaskClick={handleTaskClick} onMoveTask={handleMoveTask} />
          )}
          {(activeView === 'active' || activeView === 'review' || activeView === 'completed') && (
            <div className="space-y-2">
              {filteredTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12 italic">
                  No tasks in this view.
                </p>
              ) : (
                filteredTasks.map(task => (
                  <TaskCard key={task.id} task={task} onClick={handleTaskClick} />
                ))
              )}
            </div>
          )}
          {activeView === 'activity' && (
            <div className="space-y-2">
              {tasks
                .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
                .map(task => (
                  <TaskCard key={task.id} task={task} onClick={handleTaskClick} />
                ))
              }
            </div>
          )}
        </div>
      </div>

      <TaskDetail
        task={selectedTask}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUpdate={handleUpdate}
        onArchive={(id) => { archiveTask(id); setDetailOpen(false); }}
        onUnarchive={unarchiveTask}
      />

      <TaskCreateForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(data) => createTask(data)}
      />

      
    </div>
  );
};

export default Tasks;
