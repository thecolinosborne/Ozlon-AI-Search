import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { TaskActivityLog } from './TaskActivityLog';
import { ThreadView } from '@/components/threads/ThreadView';
import { WorkTask, TaskStatus, TaskPriority, STATUS_LABELS, STATUS_ORDER } from '@/hooks/useWorkTasks';
import { Archive, ArchiveRestore, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  const [threadId, setThreadId] = useState<string | null>(null);
  const [resolvingThread, setResolvingThread] = useState(false);

  // Resolve (or create) the unified thread paired with this task
  useEffect(() => {
    if (!task?.id || !open) { setThreadId(null); return; }
    let cancelled = false;
    (async () => {
      setResolvingThread(true);
      const { data: existing } = await supabase
        .from('chat_sessions')
        .select('id')
        .eq('linked_work_task_id', task.id)
        .maybeSingle();
      if (cancelled) return;
      if (existing?.id) { setThreadId(existing.id); setResolvingThread(false); return; }

      // Create a paired thread on demand
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess?.session?.user?.id;
      if (!userId) { setResolvingThread(false); return; }

      const { data: created, error } = await supabase.from('chat_sessions').insert({
        user_id: userId,
        title: task.title,
        kind: 'task',
        goal: task.title,
        task_status: 'awaiting_user',
        priority: task.priority,
        linked_work_task_id: task.id,
      }).select().single();
      if (cancelled) return;
      if (error) { toast.error('Could not open thread'); setResolvingThread(false); return; }

      // Seed initial user message
      const seed = [task.title, task.description].filter(Boolean).join('\n\n');
      await supabase.from('chat_messages').insert({
        session_id: created.id,
        user_id: userId,
        role: 'user',
        content: seed,
      });
      if (!cancelled) { setThreadId(created.id); setResolvingThread(false); }
    })();
    return () => { cancelled = true; };
  }, [task?.id, open]);

  if (!task) return null;

  const handleTitleSave = () => {
    if (titleValue.trim() && titleValue !== task.title) {
      onUpdate(task.id, { title: titleValue.trim() });
    }
    setEditingTitle(false);
  };

  const handleRunAI = async () => {
    if (!threadId) { toast.error('Thread not ready'); return; }
    onUpdate(task.id, { status: 'in_progress' as TaskStatus, ai_status: 'executing' });
    const { error } = await supabase.functions.invoke('execute-task', {
      body: { thread_id: threadId },
    });
    if (error) toast.error('AI run failed'); else toast.success('AI working — output will appear in Conversation');
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-3 border-b border-border/30">
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
              className="cursor-pointer hover:text-primary transition-colors text-left"
              onClick={() => { setTitleValue(task.title); setEditingTitle(true); }}
            >
              {task.title}
            </SheetTitle>
          )}
        </SheetHeader>

        <Tabs defaultValue="thread" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-3 self-start">
            <TabsTrigger value="thread">Conversation</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="thread" className="flex-1 overflow-hidden m-0 mt-3 data-[state=inactive]:hidden">
            {resolvingThread || !threadId ? (
              <div className="text-sm text-muted-foreground text-center py-8">Opening thread…</div>
            ) : (
              <div className="h-full flex flex-col">
                <div className="px-6 pb-3">
                  <Button onClick={handleRunAI} className="w-full gap-2" variant="outline">
                    <Sparkles className="w-4 h-4" /> Run AI on this thread
                  </Button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <ThreadView threadId={threadId} showHeader={false} />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="details" className="flex-1 overflow-y-auto px-6 pb-6 mt-3 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <Select value={task.status} onValueChange={(v) => onUpdate(task.id, { status: v as TaskStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
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
            </div>

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

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>Type: {task.task_type}</div>
              <div>Intent: {task.intent_type}</div>
              <div>Assigned: {task.assigned_to || 'ai'}</div>
              <div>AI: {task.ai_status}</div>
              <div>Next: {task.next_action}</div>
              <div>Created: {new Date(task.created_at).toLocaleDateString()}</div>
            </div>

            <div className="pt-2">
              {task.archived_at ? (
                <Button variant="outline" onClick={() => onUnarchive(task.id)} className="w-full gap-2">
                  <ArchiveRestore className="w-4 h-4" /> Unarchive
                </Button>
              ) : (
                <Button variant="outline" onClick={() => onArchive(task.id)} className="w-full gap-2 text-muted-foreground">
                  <Archive className="w-4 h-4" /> Archive
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="activity" className="flex-1 overflow-y-auto px-6 pb-6 mt-3">
            <TaskActivityLog entries={task.ai_activity_log || []} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
