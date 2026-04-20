import { WorkTask, PRIORITY_COLORS } from '@/hooks/useWorkTasks';

interface TaskCardProps {
  task: WorkTask;
  onClick: (task: WorkTask) => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const isAIActive = task.ai_status === 'thinking' || task.ai_status === 'executing';
  const preview = (task.last_message_preview || task.description || '').trim();

  return (
    <button
      onClick={() => onClick(task)}
      className="w-full text-left p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/30 transition-all duration-200 group"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground line-clamp-2 leading-tight">
          {task.title}
        </h4>
        {isAIActive && (
          <span className="relative flex h-2 w-2 mt-1 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
        )}
      </div>

      {preview && (
        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-snug">
          {preview}
        </p>
      )}

      <div className="flex items-center gap-2 mt-2">
        <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_COLORS[task.priority]}`} />
        {task.assigned_to && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {task.assigned_to}
          </span>
        )}
      </div>
    </button>
  );
}
