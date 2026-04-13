import { AIActivityEntry } from '@/hooks/useWorkTasks';

interface TaskActivityLogProps {
  entries: AIActivityEntry[];
}

export function TaskActivityLog({ entries }: TaskActivityLogProps) {
  if (!entries.length) {
    return (
      <p className="text-sm text-muted-foreground italic">No activity yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
            {i < entries.length - 1 && <div className="w-px flex-1 bg-border" />}
          </div>
          <div className="pb-3">
            <p className="text-sm font-medium text-foreground">{entry.action}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{entry.detail}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {entry.actor} · {new Date(entry.timestamp).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
