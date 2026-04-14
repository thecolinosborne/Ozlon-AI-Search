import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  useWorkTasks,
  WorkTask,
  TaskStatus,
  TaskPriority,
  STATUS_ORDER,
  STATUS_LABELS,
  PRIORITY_COLORS,
} from '@/hooks/useWorkTasks';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  CheckCircle2,
  Circle,
  Clock,
  Eye,
  ListTodo,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Route state machine ──────────────────────────────────────────

type RouteState = 'auth-loading' | 'unauthenticated' | 'error' | 'loading' | 'empty' | 'loaded';

function resolveRouteState(
  authLoading: boolean,
  hasSession: boolean,
  error: string | null,
  loading: boolean,
  taskCount: number,
): RouteState {
  if (authLoading) return 'auth-loading';
  if (!hasSession) return 'unauthenticated';
  if (error && taskCount === 0) return 'error';
  if (loading && taskCount === 0) return 'loading';
  if (taskCount === 0 && !loading) return 'empty';
  return 'loaded';
}

// ── Filter types ──────────────────────────────────────────────────

type TaskFilter = 'all' | 'active' | 'completed';

const FILTER_OPTIONS: { value: TaskFilter; label: string; icon: typeof ListTodo }[] = [
  { value: 'all', label: 'All Tasks', icon: ListTodo },
  { value: 'active', label: 'Active', icon: Clock },
  { value: 'completed', label: 'Completed', icon: CheckCircle2 },
];

// ── Priority display ─────────────────────────────────────────────

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const STATUS_ICONS: Record<TaskStatus, typeof Circle> = {
  todo: Circle,
  in_progress: Clock,
  up_for_review: Eye,
  completed: CheckCircle2,
};

// ══════════════════════════════════════════════════════════════════
// Task List Item
// ══════════════════════════════════════════════════════════════════

function TaskListItem({ task, onClick }: { task: WorkTask; onClick: (t: WorkTask) => void }) {
  const StatusIcon = STATUS_ICONS[task.status] ?? Circle;
  const isCompleted = task.status === 'completed';

  return (
    <button
      onClick={() => onClick(task)}
      className="w-full text-left px-4 py-3 rounded-xl border border-border/40 bg-card hover:bg-accent/40 transition-all duration-150 group"
    >
      <div className="flex items-start gap-3">
        <StatusIcon
          className={cn(
            'w-4 h-4 mt-0.5 shrink-0',
            isCompleted ? 'text-green-500' : 'text-muted-foreground',
          )}
        />
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm font-medium leading-tight',
            isCompleted && 'line-through text-muted-foreground',
          )}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
              {task.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {STATUS_LABELS[task.status]}
            </Badge>
            <span className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_COLORS[task.priority])} />
            <span className="text-[10px] text-muted-foreground">
              {PRIORITY_LABELS[task.priority]}
            </span>
            {(task.ai_status === 'thinking' || task.ai_status === 'executing') && (
              <span className="flex items-center gap-1 text-[10px] text-primary">
                <Sparkles className="w-3 h-3" />
                AI working
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground mt-0.5 shrink-0">
          {new Date(task.last_activity_at).toLocaleDateString()}
        </span>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════
// Create Task Dialog
// ══════════════════════════════════════════════════════════════════

function CreateTaskDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: Partial<WorkTask>) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: description || null, priority });
    setTitle('');
    setDescription('');
    setPriority('medium');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            New Task
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <Textarea
            placeholder="Add details or context (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
            <SelectTrigger>
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════
// Task Detail Sheet
// ══════════════════════════════════════════════════════════════════

function TaskDetailSheet({
  task,
  open,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: WorkTask | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<WorkTask>) => void;
  onDelete: (id: string) => void;
}) {
  if (!task) return null;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{task.title}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Status & Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <Select
                value={task.status}
                onValueChange={(v) => onUpdate(task.id, { status: v as TaskStatus })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
              <Select
                value={task.priority}
                onValueChange={(v) => onUpdate(task.id, { priority: v as TaskPriority })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description</label>
            <Textarea
              value={task.description || ''}
              onChange={(e) => onUpdate(task.id, { description: e.target.value })}
              placeholder="Add a description..."
              rows={4}
            />
          </div>

          <Separator />

          {/* AI Status */}
          {task.ai_status !== 'idle' && (
            <div className="flex items-center gap-2 text-sm text-primary">
              <Sparkles className="w-4 h-4" />
              AI Status: {task.ai_status}
            </div>
          )}

          {/* Draft output */}
          {task.draft_output && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">AI Draft</label>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/30 text-sm whitespace-pre-wrap">
                {task.draft_output}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>Type: {task.task_type}</div>
            <div>Assigned: {task.assigned_to || 'ai'}</div>
            <div>Created: {new Date(task.created_at).toLocaleDateString()}</div>
            {task.completed_at && (
              <div>Completed: {new Date(task.completed_at).toLocaleDateString()}</div>
            )}
          </div>

          <Separator />

          {/* Delete */}
          <Button
            variant="outline"
            onClick={() => {
              onDelete(task.id);
              onClose();
            }}
            className="w-full gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            Delete Task
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ══════════════════════════════════════════════════════════════════
// Page Component
// ══════════════════════════════════════════════════════════════════

const Tasks = () => {
  const navigate = useNavigate();
  const { authLoading, session } = useAuth();
  const {
    tasks,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
  } = useWorkTasks();

  const [filter, setFilter] = useState<TaskFilter>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const routeState = resolveRouteState(authLoading, !!session, error, loading, tasks.length);

  // Derive selected task from live data
  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return tasks.find(t => t.id === selectedTaskId) ?? null;
  }, [selectedTaskId, tasks]);

  // Close detail if task was removed
  useEffect(() => {
    if (detailOpen && selectedTaskId && !selectedTask) {
      setDetailOpen(false);
      setSelectedTaskId(null);
    }
  }, [detailOpen, selectedTaskId, selectedTask]);

  // Redirect if unauthenticated
  useEffect(() => {
    if (routeState === 'unauthenticated') navigate('/auth');
  }, [routeState, navigate]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    switch (filter) {
      case 'active':
        return tasks.filter(t => t.status !== 'completed');
      case 'completed':
        return tasks.filter(t => t.status === 'completed');
      default:
        return tasks;
    }
  }, [tasks, filter]);

  const handleTaskClick = useCallback((task: WorkTask) => {
    setSelectedTaskId(task.id);
    setDetailOpen(true);
  }, []);

  const handleDetailClose = useCallback(() => {
    setDetailOpen(false);
    setTimeout(() => setSelectedTaskId(null), 200);
  }, []);

  // ── Terminal route states ──────────────────────────────────────

  if (routeState === 'auth-loading' || routeState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (routeState === 'unauthenticated') return null;

  if (routeState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="text-center space-y-4 max-w-sm">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => fetchTasks()} className="gap-1.5">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (routeState === 'empty') {
    return (
      <div className="min-h-screen bg-background">
        <TasksHeader onCreateClick={() => setCreateOpen(true)} />
        <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">No tasks yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Create your first task to get started. AI can help you break down work, draft content, and manage priorities.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Create your first task
          </Button>
        </div>
        <CreateTaskDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={createTask}
        />
      </div>
    );
  }

  // ── Loaded state ───────────────────────────────────────────────

  const counts = {
    all: tasks.length,
    active: tasks.filter(t => t.status !== 'completed').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <TasksHeader onCreateClick={() => setCreateOpen(true)} />

      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Filter bar */}
        <div className="flex items-center gap-1 mb-4 p-1 bg-muted/50 rounded-lg w-fit">
          {FILTER_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                filter === value
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              <span className="text-xs ml-0.5 opacity-60">
                {counts[value]}
              </span>
            </button>
          ))}
        </div>

        {/* Task list */}
        <div className="space-y-2">
          {filteredTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12 italic">
              No tasks match this filter.
            </p>
          ) : (
            filteredTasks.map(task => (
              <TaskListItem key={task.id} task={task} onClick={handleTaskClick} />
            ))
          )}
        </div>
      </div>

      <TaskDetailSheet
        task={selectedTask}
        open={detailOpen}
        onClose={handleDetailClose}
        onUpdate={updateTask}
        onDelete={deleteTask}
      />

      <CreateTaskDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createTask}
      />
    </div>
  );
};

// ── Shared header ────────────────────────────────────────────────

function TasksHeader({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30 px-4 py-3">
      <div className="flex items-center justify-between max-w-3xl mx-auto">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
        </div>
        <Button size="sm" onClick={onCreateClick} className="gap-1.5">
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>
    </div>
  );
}

export default Tasks;
