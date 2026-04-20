import { cn } from '@/lib/utils';
import { LayoutDashboard, Columns3, Zap, CheckCircle2, Activity, Trash2 } from 'lucide-react';

export type TaskView = 'overview' | 'board' | 'active' | 'completed' | 'activity' | 'trash';

const views: { id: TaskView; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'active', label: 'Working', icon: Zap },
  { id: 'completed', label: 'Done', icon: CheckCircle2 },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

interface TasksSidebarProps {
  activeView: TaskView;
  onViewChange: (view: TaskView) => void;
  counts: Record<string, number>;
}

export function TasksSidebar({ activeView, onViewChange, counts }: TasksSidebarProps) {
  return (
    <nav className="space-y-1">
      {views.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onViewChange(id)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
            activeView === id
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          <Icon className="w-4 h-4" />
          <span>{label}</span>
          {counts[id] !== undefined && counts[id] > 0 && (
            <span className="ml-auto text-xs bg-muted rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
              {counts[id]}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
