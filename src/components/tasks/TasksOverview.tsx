import { WorkTask, STATUS_ORDER, STATUS_LABELS } from '@/hooks/useWorkTasks';
import { cn } from '@/lib/utils';

interface TasksOverviewProps {
  tasks: WorkTask[];
  onTaskClick: (task: WorkTask) => void;
}

export function TasksOverview({ tasks, onTaskClick }: TasksOverviewProps) {
  const statusCounts = STATUS_ORDER.map(s => ({
    status: s,
    label: STATUS_LABELS[s],
    count: tasks.filter(t => t.status === s).length,
  }));

  const aiWorking = tasks.filter(t => t.ai_status === 'thinking' || t.ai_status === 'executing');

  const recentActivity = tasks
    .slice()
    .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
    .slice(0, 8);

  const statusColors: Record<string, string> = {
    todo: 'bg-muted-foreground/20',
    in_progress: 'bg-primary/20',
    done: 'bg-green-500/20',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {statusCounts.map(({ status, label, count }) => (
          <div key={status} className={cn('rounded-xl p-4 border border-border/50', statusColors[status])}>
            <p className="text-2xl font-semibold text-foreground">{count}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>

      {aiWorking.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            AI Working Now
          </h3>
          <div className="space-y-2">
            {aiWorking.map(task => (
              <button
                key={task.id}
                onClick={() => onTaskClick(task)}
                className="w-full text-left p-3 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
              >
                <p className="text-sm font-medium">{task.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{task.ai_status} · {task.task_type}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Recent Activity</h3>
        <div className="space-y-2">
          {recentActivity.map(task => (
            <button
              key={task.id}
              onClick={() => onTaskClick(task)}
              className="w-full text-left p-2 rounded-lg hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{task.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(task.last_activity_at).toLocaleString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
