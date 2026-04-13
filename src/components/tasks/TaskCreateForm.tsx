import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TaskPriority, TaskType, IntentType } from '@/hooks/useWorkTasks';

interface TaskCreateFormProps {
  open: boolean;
  onClose: () => void;
  onCreate: (task: {
    title: string;
    description: string;
    priority: TaskPriority;
    task_type: TaskType;
    intent_type: IntentType;
  }) => void;
}

export function TaskCreateForm({ open, onClose, onCreate }: TaskCreateFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [taskType, setTaskType] = useState<TaskType>('general');
  const [intentType, setIntentType] = useState<IntentType>('ops');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description, priority, task_type: taskType, intent_type: intentType });
    setTitle('');
    setDescription('');
    setPriority('medium');
    setTaskType('general');
    setIntentType('ops');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <div className="grid grid-cols-3 gap-2">
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
              <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="research">Research</SelectItem>
                <SelectItem value="content">Content</SelectItem>
                <SelectItem value="outreach">Outreach</SelectItem>
                <SelectItem value="ops">Ops</SelectItem>
                <SelectItem value="creative">Creative</SelectItem>
              </SelectContent>
            </Select>
            <Select value={intentType} onValueChange={(v) => setIntentType(v as IntentType)}>
              <SelectTrigger><SelectValue placeholder="Intent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ops">Ops</SelectItem>
                <SelectItem value="lead_gen">Lead Gen</SelectItem>
                <SelectItem value="fulfillment">Fulfillment</SelectItem>
                <SelectItem value="content">Content</SelectItem>
                <SelectItem value="research">Research</SelectItem>
                <SelectItem value="outreach">Outreach</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!title.trim()}>Create Task</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
