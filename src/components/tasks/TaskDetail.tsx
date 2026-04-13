import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { TaskActivityLog } from './TaskActivityLog';
import { WorkTask, TaskStatus, TaskPriority, STATUS_LABELS, STATUS_ORDER } from '@/hooks/useWorkTasks';
import { Archive, ArchiveRestore, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface TaskDetailProps {
  task: WorkTask | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<WorkTask>) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
}

export function TaskDetail({ task, open, onClose, onUpdate, onArchive, onUnarchive }: TaskDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  if (!task) return null;

  const handleTitleSave = () => {
    if (titleValue.trim() && titleValue !== task.title) {
      onUpdate(task.id, { title: titleValue.trim() });
    }
    setEditingTitle(false);
  };

  const handleRefineWithAI = () => {
    const newEntry = {
      timestamp: new Date().toISOString(),
      action: 'Refine with AI requested',
      detail: 'User requested AI refinement of this task',
      actor: 'user',
      status: 'triggered',
    };
    onUpdate(task.id, {
      status: 'in_progress' as TaskStatus,
      ai_status: 'executing',
      next_action: 'waiting_on_ai',
      ai_activity_log: [...(task.ai_activity_log || []), newEntry],
    } as Partial<WorkTask>);
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          {editingTitle ? (
            <Input
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
              autoFocus
            />
          ) : (
            <SheetTitle
              className="cursor-pointer hover:text-primary transition-colors"
              onClick={() => {
                setTitleValue(task.title);
                setEditingTitle(true);
              }}
            >
              {task.title}
            </SheetTitle>
          )}
        </SheetHeader>

        <div className="mt-6 space-y-6">
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
              rows={3}
            />
          </div>

          <Separator />

          {/* Draft Output */}
          {task.draft_output && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Draft Output</label>
              <div className="prose prose-sm dark:prose-invert max-w-none p-3 rounded-lg bg-muted/30 border border-border/30">
                <ReactMarkdown>{task.draft_output}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* Refine with AI button */}
          <Button
            variant="outline"
            onClick={handleRefineWithAI}
            className="w-full gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Refine with AI
          </Button>

          <Separator />

          {/* AI Activity Timeline */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">AI Activity</label>
            <TaskActivityLog entries={task.ai_activity_log || []} />
          </div>

          <Separator />

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>Type: {task.task_type}</div>
            <div>Intent: {task.intent_type}</div>
            <div>Assigned: {task.assigned_to || 'ai'}</div>
            <div>AI Status: {task.ai_status}</div>
            <div>Next: {task.next_action}</div>
            <div>Created: {new Date(task.created_at).toLocaleDateString()}</div>
          </div>

          {/* Archive button */}
          <div className="pt-2">
            {task.archived_at ? (
              <Button variant="outline" onClick={() => onUnarchive(task.id)} className="w-full gap-2">
                <ArchiveRestore className="w-4 h-4" />
                Unarchive
              </Button>
            ) : (
              <Button variant="outline" onClick={() => onArchive(task.id)} className="w-full gap-2 text-muted-foreground">
                <Archive className="w-4 h-4" />
                Archive Task
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
