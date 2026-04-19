import { useState, useCallback, useEffect, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  LayoutGrid,
  List,
  CheckCircle2,
  Circle,
  Clock,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ══════════════════════════════════════════════════════════════════
// Route state machine (no auth)
// ══════════════════════════════════════════════════════════════════

type RouteState = 'error' | 'loading' | 'empty' | 'loaded';

function resolveRouteState(
  error: string | null,
  loading: boolean,
  taskCount: number,
): RouteState {
  if (error && taskCount === 0) return 'error';
  if (loading && taskCount === 0) return 'loading';
  if (taskCount === 0 && !loading) return 'empty';
  return 'loaded';
}

// ══════════════════════════════════════════════════════════════════
// Display helpers
// ══════════════════════════════════════════════════════════════════

type ViewMode = 'board' | 'list';

const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'up_for_review', 'completed'];

const BOARD_COLUMN_LABELS: Record<TaskStatus, string> = {
  todo: 'Backlog',
  in_progress: 'In Progress',
  up_for_review: 'Review',
  completed: 'Done',
};

const BOARD_COLUMN_COLORS: Record<TaskStatus, string> = {
  todo: 'border-t-muted-foreground/40',
  in_progress: 'border-t-primary',
  up_for_review: 'border-t-yellow-500',
  completed: 'border-t-green-500',
};

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
// Board Card
// ══════════════════════════════════════════════════════════════════

function BoardCard({ task, onClick }: { task: WorkTask; onClick: (t: WorkTask) => void }) {
  const isAI = task.ai_status === 'thinking' || task.ai_status === 'executing';

  return (
    <button
      onClick={() => onClick(task)}
      className="w-full text-left p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/30 hover:shadow-sm transition-all duration-150 group"
    >
      <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
        {task.title}
      </p>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{task.description}</p>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', PRIORITY_COLORS[task.priority])} />
        <span className="text-[10px] text-muted-foreground">{PRIORITY_LABELS[task.priority]}</span>
        {task.assigned_to && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 ml-auto">
            {task.assigned_to}
          </Badge>
        )}
        {isAI && <Sparkles className="w-3 h-3 text-primary shrink-0" />}
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════
// Board Column
// ══════════════════════════════════════════════════════════════════

function BoardColumn({
  status,
  tasks,
  onTaskClick,
  onMoveTask,
  onCreateInColumn,
}: {
  status: TaskStatus;
  tasks: WorkTask[];
  onTaskClick: (t: WorkTask) => void;
  onMoveTask: (taskId: string, newStatus: TaskStatus) => void;
  onCreateInColumn: (status: TaskStatus) => void;
}) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) onMoveTask(taskId, status);
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border/40 bg-muted/20 min-h-[300px] border-t-2',
        BOARD_COLUMN_COLORS[status],
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {BOARD_COLUMN_LABELS[status]}
          </h3>
          <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 min-w-[18px] text-center font-medium">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={() => onCreateInColumn(status)}
          className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto">
        {tasks.map(task => (
          <div
            key={task.id}
            draggable
            onDragStart={(e) => handleDragStart(e, task.id)}
            className="cursor-grab active:cursor-grabbing"
          >
            <BoardCard task={task} onClick={onTaskClick} />
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground italic">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// List Row
// ══════════════════════════════════════════════════════════════════

function ListRow({ task, onClick }: { task: WorkTask; onClick: (t: WorkTask) => void }) {
  const StatusIcon = STATUS_ICONS[task.status] ?? Circle;
  const isCompleted = task.status === 'completed';

  return (
    <button
      onClick={() => onClick(task)}
      className="w-full text-left px-4 py-3 rounded-xl border border-border/40 bg-card hover:bg-accent/30 transition-all duration-150"
    >
      <div className="flex items-center gap-3">
        <StatusIcon className={cn('w-4 h-4 shrink-0', isCompleted ? 'text-green-500' : 'text-muted-foreground')} />
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-medium', isCompleted && 'line-through text-muted-foreground')}>
            {task.title}
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
          {STATUS_LABELS[task.status]}
        </Badge>
        <span className={cn('w-2 h-2 rounded-full shrink-0', PRIORITY_COLORS[task.priority])} />
        {task.assigned_to && (
          <span className="text-[10px] text-muted-foreground shrink-0">{task.assigned_to}</span>
        )}
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
  defaultStatus,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: Partial<WorkTask>) => void;
  defaultStatus?: TaskStatus;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assignee, setAssignee] = useState('ai');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      description: description || null,
      priority,
      assigned_to: assignee || 'ai',
      status: defaultStatus || 'todo',
    });
    setTitle('');
    setDescription('');
    setPriority('medium');
    setAssignee('ai');
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
          <Input placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Textarea placeholder="Add details or context (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assignee</label>
              <Input placeholder="ai" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            </div>
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');

  useEffect(() => {
    setNotesDraft(task?.revision_notes || '');
  }, [task?.id, task?.revision_notes]);

  if (!task) return null;

  const handleTitleSave = () => {
    if (titleDraft.trim() && titleDraft !== task.title) {
      onUpdate(task.id, { title: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const handleNotesSave = () => {
    if (notesDraft !== (task.revision_notes || '')) {
      onUpdate(task.id, { revision_notes: notesDraft || null });
    }
  };

  const aiLog = task.ai_activity_log || [];

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          {editingTitle ? (
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
              autoFocus
              className="text-lg font-semibold"
            />
          ) : (
            <SheetTitle
              className="text-left cursor-pointer hover:text-primary transition-colors"
              onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }}
            >
              {task.title}
            </SheetTitle>
          )}
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <Select value={task.status} onValueChange={(v) => onUpdate(task.id, { status: v as TaskStatus })}>
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
              <Select value={task.priority} onValueChange={(v) => onUpdate(task.id, { priority: v as TaskPriority })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assignee</label>
              <Input
                value={task.assigned_to || ''}
                onChange={(e) => onUpdate(task.id, { assigned_to: e.target.value || null })}
                placeholder="ai"
                className="h-9"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description</label>
            <Textarea
              value={task.description || ''}
              onChange={(e) => onUpdate(task.id, { description: e.target.value })}
              placeholder="Describe this task..."
              rows={4}
            />
          </div>

          <Separator />

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={handleNotesSave}
              placeholder="Add working notes, context, or follow-ups..."
              rows={3}
            />
          </div>

          {task.ai_status !== 'idle' && (
            <div className="flex items-center gap-2 text-sm text-primary bg-primary/5 rounded-lg px-3 py-2">
              <Sparkles className="w-4 h-4" />
              <span>AI: {task.ai_status}</span>
            </div>
          )}

          {task.draft_output && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">AI Draft</label>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/30 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
                {task.draft_output}
              </div>
            </div>
          )}

          <Separator />

          {aiLog.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Activity</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {aiLog.map((entry, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-foreground">{entry.action}</p>
                      <p className="text-[10px] text-muted-foreground">{entry.detail}</p>
                      <p className="text-[10px] text-muted-foreground/60">
                        {entry.actor} · {new Date(entry.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>Type: {task.task_type}</div>
            <div>Intent: {task.intent_type}</div>
            <div>Created: {new Date(task.created_at).toLocaleDateString()}</div>
            {task.completed_at && (
              <div>Completed: {new Date(task.completed_at).toLocaleDateString()}</div>
            )}
          </div>

          <Separator />

          <Button
            variant="outline"
            onClick={() => { onDelete(task.id); onClose(); }}
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
// Inline view-mode toolbar (no header, lives inside Tasks tab)
// ══════════════════════════════════════════════════════════════════

function TasksToolbar({
  view,
  onViewChange,
  onCreateClick,
  count,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onCreateClick: () => void;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <p className="text-xs text-muted-foreground">
        {count} {count === 1 ? "task" : "tasks"}
      </p>
      <div className="flex items-center gap-2">
        <div className="flex items-center border border-border/50 rounded-lg overflow-hidden">
          <button
            onClick={() => onViewChange('board')}
            className={cn(
              'p-1.5 transition-colors',
              view === 'board' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            title="Board view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewChange('list')}
            className={cn(
              'p-1.5 transition-colors',
              view === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
        <Button size="sm" onClick={onCreateClick} className="gap-1.5">
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Page Component
// ══════════════════════════════════════════════════════════════════

function TasksWorkspace() {
  const {
    tasks,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
  } = useWorkTasks();

  const [view, setView] = useState<ViewMode>('board');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<TaskStatus>('todo');

  const routeState = resolveRouteState(error, loading, tasks.length);

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return tasks.find(t => t.id === selectedTaskId) ?? null;
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (detailOpen && selectedTaskId && !selectedTask) {
      setDetailOpen(false);
      setSelectedTaskId(null);
    }
  }, [detailOpen, selectedTaskId, selectedTask]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, WorkTask[]> = {
      todo: [], in_progress: [], up_for_review: [], completed: [],
    };
    for (const t of tasks) grouped[t.status]?.push(t);
    for (const key of BOARD_COLUMNS) {
      grouped[key].sort((a, b) => a.board_position - b.board_position);
    }
    return grouped;
  }, [tasks]);

  const handleTaskClick = useCallback((task: WorkTask) => {
    setSelectedTaskId(task.id);
    setDetailOpen(true);
  }, []);

  const handleDetailClose = useCallback(() => {
    setDetailOpen(false);
    setTimeout(() => setSelectedTaskId(null), 200);
  }, []);

  const handleMoveTask = useCallback((taskId: string, newStatus: TaskStatus) => {
    updateTask(taskId, { status: newStatus });
  }, [updateTask]);

  const handleCreateInColumn = useCallback((status: TaskStatus) => {
    setCreateDefaultStatus(status);
    setCreateOpen(true);
  }, []);

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
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (routeState === 'empty') {
    return (
      <div>
        <TasksToolbar view={view} onViewChange={setView} onCreateClick={() => setCreateOpen(true)} count={0} />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">No tasks yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Create your first task to get started. Your AI workspace will help you organize, prioritize, and execute.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Create your first task
          </Button>
        </div>
        <CreateTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createTask} defaultStatus={createDefaultStatus} />
      </div>
    );
  }

  return (
    <div>
      <TasksToolbar
        view={view}
        onViewChange={setView}
        onCreateClick={() => { setCreateDefaultStatus('todo'); setCreateOpen(true); }}
        count={tasks.length}
      />

      {view === 'board' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {BOARD_COLUMNS.map(status => (
            <BoardColumn
              key={status}
              status={status}
              tasks={tasksByStatus[status]}
              onTaskClick={handleTaskClick}
              onMoveTask={handleMoveTask}
              onCreateInColumn={handleCreateInColumn}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {[...tasks]
            .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
            .map(task => (
              <ListRow key={task.id} task={task} onClick={handleTaskClick} />
            ))
          }
        </div>
      )}

      <TaskDetailSheet task={selectedTask} open={detailOpen} onClose={handleDetailClose} onUpdate={updateTask} onDelete={deleteTask} />
      <CreateTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createTask} defaultStatus={createDefaultStatus} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Page shell with Tasks / Routines tabs
// ══════════════════════════════════════════════════════════════════

import { BottomNav } from '@/components/navigation/BottomNav';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RoutinesPanel } from '@/components/tasks/RoutinesPanel';
import { ListChecks, Repeat } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const Tasks = () => {
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
          <Sparkles className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
            <p className="text-xs text-muted-foreground">
              One-off tasks and recurring routines, all in one place.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full max-w-sm grid-cols-2 mb-4">
            <TabsTrigger value="tasks" className="gap-2">
              <ListChecks className="w-4 h-4" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="routines" className="gap-2">
              <Repeat className="w-4 h-4" />
              Routines
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

      <BottomNav />
    </div>
  );
};

export default Tasks;
