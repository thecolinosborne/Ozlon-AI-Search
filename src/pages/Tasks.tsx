import { useState, useCallback, useEffect, useMemo } from 'react';
import { useWorkTasks, WorkTask, TaskStatus } from '@/hooks/useWorkTasks';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, AlertCircle, RefreshCw, Sparkles, ArchiveRestore, Trash2, ArrowLeft } from 'lucide-react';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import { TaskDetail } from '@/components/tasks/TaskDetail';
import { TaskCard } from '@/components/tasks/TaskCard';
import { TasksOverview } from '@/components/tasks/TasksOverview';
import { TasksSidebar, TaskView } from '@/components/tasks/TasksSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RoutinesPanel } from '@/components/tasks/RoutinesPanel';
import { ListChecks, Repeat } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

type RouteState = 'error' | 'loading' | 'empty' | 'loaded';
function resolveRouteState(error: string | null, loading: boolean, taskCount: number): RouteState {
  if (error && taskCount === 0) return 'error';
  if (loading && taskCount === 0) return 'loading';
  if (taskCount === 0 && !loading) return 'empty';
  return 'loaded';
}

// ── Create Task Dialog ──────────────────────────────────────────────

function CreateTaskDialog({
  open, onClose, onCreate,
}: {
  open: boolean; onClose: () => void; onCreate: (data: Partial<WorkTask>) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      description: description || null,
      priority,
      assigned_to: 'ai',
      status: 'todo',
    });
    setTitle(''); setDescription(''); setPriority('medium');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> New Task
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Textarea placeholder="Add details or context (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!title.trim()}>Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Trash view ─────────────────────────────────────────────────────

function TrashWorkspace() {
  const { tasks, loading, restoreFromTrash, purgeNow } = useWorkTasks({ trash: true });

  if (loading && tasks.length === 0) {
    return <div className="text-sm text-muted-foreground text-center py-12">Loading…</div>;
  }
  if (tasks.length === 0) {
    return <div className="text-sm text-muted-foreground text-center py-12">Trash is empty</div>;
  }

  const daysLeft = (deletedAt: string) => {
    const ms = new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-3">
        Items here are deleted permanently 30 days after they enter the trash.
      </p>
      {tasks.map((t) => (
        <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-card">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{t.title}</p>
            <p className="text-xs text-muted-foreground">
              {t.deleted_at ? `${daysLeft(t.deleted_at)} days left` : 'Trashed'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => restoreFromTrash(t.id)} className="gap-1.5">
            <ArchiveRestore className="w-3.5 h-3.5" /> Restore
          </Button>
          <Button size="sm" variant="ghost" onClick={() => purgeNow(t.id)} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" /> Delete now
          </Button>
        </div>
      ))}
    </div>
  );
}

// ── Main workspace ────────────────────────────────────────────────

function TasksWorkspace() {
  const {
    tasks, loading, error, fetchTasks,
    createTask, updateTask, runTaskWithAI,
    archiveTask, unarchiveTask, markDone,
  } = useWorkTasks();

  const [activeView, setActiveView] = useState<TaskView>('board');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const routeState = resolveRouteState(error, loading, tasks.length);

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks],
  );

  useEffect(() => {
    if (detailOpen && selectedTaskId && !selectedTask) {
      setDetailOpen(false);
      setSelectedTaskId(null);
    }
  }, [detailOpen, selectedTaskId, selectedTask]);

  const handleTaskClick = useCallback((task: WorkTask) => {
    setSelectedTaskId(task.id);
    setDetailOpen(true);
  }, []);

  const handleDetailClose = useCallback(() => {
    setDetailOpen(false);
    setTimeout(() => setSelectedTaskId(null), 200);
  }, []);

  const handleMoveTask = useCallback(
    (taskId: string, newStatus: TaskStatus) => {
      updateTask(taskId, { status: newStatus });
    },
    [updateTask],
  );

  const handleCreate = useCallback(async (data: Partial<WorkTask>) => {
    const created = await createTask(data);
    if (created && (created.assigned_to === 'ai' || !created.assigned_to)) {
      runTaskWithAI(created.id);
    }
  }, [createTask, runTaskWithAI]);

  const counts: Record<string, number> = {
    overview: tasks.length,
    board: tasks.length,
    active: tasks.filter((t) => t.status === 'in_progress').length,
    completed: tasks.filter((t) => t.status === 'done').length,
    activity: tasks.filter((t) => t.ai_status === 'executing' || t.ai_status === 'thinking').length,
  };

  if (routeState === 'loading') {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (routeState === 'error') {
    return (
      <div className="flex items-center justify-center px-4 py-16">
        <div className="text-center space-y-4 max-w-sm">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => fetchTasks()} className="gap-1.5">
            <RefreshCw className="w-4 h-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const renderView = () => {
    if (activeView === 'trash') return <TrashWorkspace />;

    if (routeState === 'empty') {
      return (
        <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">No tasks yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Create your first task. Each task is a chat thread with the AI — type the request, get the deliverable.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> Create your first task
          </Button>
        </div>
      );
    }

    if (activeView === 'overview') return <TasksOverview tasks={tasks} onTaskClick={handleTaskClick} />;
    if (activeView === 'board') return <TaskBoard tasks={tasks} onTaskClick={handleTaskClick} onMoveTask={handleMoveTask} />;
    if (activeView === 'active') {
      const list = tasks.filter((t) => t.status === 'in_progress');
      return <TaskList tasks={list} onClick={handleTaskClick} emptyText="No tasks are being worked on." />;
    }
    if (activeView === 'completed') {
      const list = tasks.filter((t) => t.status === 'done');
      return <TaskList tasks={list} onClick={handleTaskClick} emptyText="Nothing here yet." />;
    }
    if (activeView === 'activity') {
      const list = tasks.filter((t) => t.ai_status === 'executing' || t.ai_status === 'thinking');
      return <TaskList tasks={list} onClick={handleTaskClick} emptyText="The AI isn't working on anything right now." />;
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
      <aside className="space-y-3">
        <Button onClick={() => setCreateOpen(true)} className="w-full gap-1.5" size="sm">
          <Plus className="w-4 h-4" /> New Task
        </Button>
        <TasksSidebar activeView={activeView} onViewChange={setActiveView} counts={counts} />
      </aside>

      <div className="min-w-0">{renderView()}</div>

      <TaskDetail
        task={selectedTask}
        open={detailOpen}
        onClose={handleDetailClose}
        onUpdate={updateTask}
        onArchive={archiveTask}
        onUnarchive={unarchiveTask}
        onMarkDone={markDone}
      />
      <CreateTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
    </div>
  );
}

function TaskList({ tasks, onClick, emptyText }: { tasks: WorkTask[]; onClick: (t: WorkTask) => void; emptyText: string }) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-12">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} onClick={onClick} />
      ))}
    </div>
  );
}

// ── Page shell with Tasks / Routines tabs ─────────────────────────

const Tasks = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'routines' ? 'routines' : 'tasks';
  const [tab, setTab] = useState<'tasks' | 'routines'>(initialTab);

  const handleTabChange = (v: string) => {
    const next = v as 'tasks' | 'routines';
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'routines') params.set('tab', 'routines');
    else params.delete('tab');
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            className="h-9 w-9 -ml-2"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <Sparkles className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
            <p className="text-xs text-muted-foreground">
              Each task is a chat thread. Tell the AI what you want — review the output inline.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full max-w-sm grid-cols-2 mb-4">
            <TabsTrigger value="tasks" className="gap-2">
              <ListChecks className="w-4 h-4" /> Tasks
            </TabsTrigger>
            <TabsTrigger value="routines" className="gap-2">
              <Repeat className="w-4 h-4" /> Routines
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="mt-0">
            <TasksWorkspace />
          </TabsContent>

          <TabsContent value="routines" className="mt-0 max-w-3xl">
            <RoutinesPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Tasks;
