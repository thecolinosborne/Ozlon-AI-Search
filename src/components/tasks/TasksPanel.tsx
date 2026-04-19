import { useMemo, useState } from "react";
import { useWorkTasks, STATUS_LABELS, STATUS_ORDER, type TaskStatus, type WorkTask } from "@/hooks/useWorkTasks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Trash2, CheckCircle2, Circle, Clock, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  todo: Circle,
  in_progress: Clock,
  up_for_review: Eye,
  completed: CheckCircle2,
};

export function TasksPanel() {
  const { tasks, loading, error, createTask, updateTask, deleteTask } = useWorkTasks();
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");

  const grouped = useMemo(() => {
    const g: Record<TaskStatus, WorkTask[]> = {
      todo: [], in_progress: [], up_for_review: [], completed: [],
    };
    for (const t of tasks) g[t.status]?.push(t);
    return g;
  }, [tasks]);

  const visible = filter === "all" ? tasks : grouped[filter];

  const handleCreate = async () => {
    if (!title.trim()) return;
    await createTask({
      title: title.trim(),
      description: description.trim() || null,
      priority: priority as WorkTask["priority"],
    });
    setTitle(""); setDescription(""); setPriority("medium");
    setCreateOpen(false);
  };

  const cycleStatus = (t: WorkTask) => {
    const idx = STATUS_ORDER.indexOf(t.status);
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    updateTask(t.id, { status: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v as TaskStatus | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({tasks.length})</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]} ({grouped[s].length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" />
              New Task
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Task</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  placeholder="Draft Q2 outreach email"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea
                  rows={4}
                  placeholder="What needs to happen, context, deliverable…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
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
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : error ? (
        <Card className="p-6 text-center text-sm text-destructive">{error}</Card>
      ) : visible.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No tasks yet.</p>
          <p className="text-xs mt-1">
            Tap "New Task" or ask the assistant: <em>"Create a task to draft the Q2 client update."</em>
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((t) => {
            const Icon = STATUS_ICON[t.status];
            return (
              <Card key={t.id} className="p-4">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => cycleStatus(t)}
                    className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    title={`Status: ${STATUS_LABELS[t.status]} (click to cycle)`}
                  >
                    <Icon className={cn("w-5 h-5", t.status === "completed" && "text-green-500")} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className={cn("font-medium truncate", t.status === "completed" && "line-through text-muted-foreground")}>
                        {t.title}
                      </h3>
                      <Badge variant="secondary" className="text-xs capitalize">{t.priority}</Badge>
                      <Badge variant="outline" className="text-xs">{STATUS_LABELS[t.status]}</Badge>
                    </div>
                    {t.description && (
                      <p className="text-xs text-muted-foreground mb-1 line-clamp-2">{t.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Updated {formatDistanceToNow(new Date(t.last_activity_at), { addSuffix: true })}
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => deleteTask(t.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
