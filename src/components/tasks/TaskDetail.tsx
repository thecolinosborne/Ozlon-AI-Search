import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ThreadView } from '@/components/threads/ThreadView';
import { WorkTask, TaskStatus, TaskPriority, STATUS_LABELS, STATUS_ORDER } from '@/hooks/useWorkTasks';
import { Archive, ArchiveRestore, Check, ChevronDown, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface TaskDetailProps {
  task: WorkTask | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<WorkTask>) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onMarkDone: (id: string) => Promise<boolean> | void;
}

export function TaskDetail({ task, open, onClose, onUpdate, onArchive, onUnarchive, onMarkDone }: TaskDetailProps) {
  const navigate = useNavigate();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [resolvingThread, setResolvingThread] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

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

      const { data: sess } = await supabase.auth.getSession();
      const userId = sess?.session?.user?.id;
      if (!userId) { setResolvingThread(false); return; }

      const { data: created, error } = await supabase.from('chat_sessions').insert({
        user_id: userId,
        title: task.title,
        kind: 'task',
        goal: task.title,
        task_status: 'working',
        priority: task.priority,
        linked_work_task_id: task.id,
      }).select().single();
      if (cancelled) return;
      if (error) { toast.error('Could not open thread'); setResolvingThread(false); return; }

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
  }, [task?.id, open, task?.title, task?.description, task?.priority]);

  if (!task) return null;

  const handleTitleSave = () => {
    if (titleValue.trim() && titleValue !== task.title) {
      onUpdate(task.id, { title: titleValue.trim() });
    }
    setEditingTitle(false);
  };

  const handleMarkDone = async () => {
    const ok = await onMarkDone(task.id);
    if (ok !== false) onClose();
  };

  const handleOpenInChat = () => {
    if (!threadId) { toast.error('Thread not ready'); return; }
    navigate(`/?session=${threadId}`);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-3 border-b border-border/30 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
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
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[task.status]}</Badge>
                <Badge variant="outline" className="text-[10px] capitalize">{task.priority}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="outline" onClick={handleOpenInChat} className="gap-1.5" disabled={!threadId}>
                <MessageSquare className="w-3.5 h-3.5" /> Open in chat
              </Button>
              <Button size="sm" onClick={handleMarkDone} className="gap-1.5">
                <Check className="w-3.5 h-3.5" /> Mark done
              </Button>
            </div>
          </div>

          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={`w-3 h-3 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
              Details
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Status</label>
                  <Select value={task.status} onValueChange={(v) => onUpdate(task.id, { status: v as TaskStatus })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Priority</label>
                  <Select value={task.priority} onValueChange={(v) => onUpdate(task.id, { priority: v as TaskPriority })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Description</label>
                <Textarea
                  value={task.description || ''}
                  onChange={(e) => onUpdate(task.id, { description: e.target.value })}
                  placeholder="Add a description..."
                  rows={2}
                  className="text-xs"
                />
              </div>
              <div className="flex justify-end">
                {task.archived_at ? (
                  <Button variant="ghost" size="sm" onClick={() => onUnarchive(task.id)} className="gap-1.5 text-xs">
                    <ArchiveRestore className="w-3.5 h-3.5" /> Unarchive
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => onArchive(task.id)} className="gap-1.5 text-xs text-muted-foreground">
                    <Archive className="w-3.5 h-3.5" /> Archive
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </SheetHeader>

        <div className="flex-1 overflow-hidden">
          {resolvingThread || !threadId ? (
            <div className="text-sm text-muted-foreground text-center py-8">Opening thread…</div>
          ) : (
            <ThreadView threadId={threadId} showHeader={false} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
