import { Film, MonitorPlay, Smartphone, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { VideoTaskWithParent } from '@/types/video';
import { RENDER_STATUS_LABELS, RENDER_STATUS_COLORS, OUTPUT_TYPE_LABELS, EDIT_PLAN_STATUS_LABELS } from '@/types/video';

interface VideoTaskCardProps {
  task: VideoTaskWithParent;
  onClick: (task: VideoTaskWithParent) => void;
}

const aspectIcons = {
  '16:9': MonitorPlay,
  '9:16': Smartphone,
  '1:1': Square,
};

export function VideoTaskCard({ task, onClick }: VideoTaskCardProps) {
  const AspectIcon = aspectIcons[task.aspect_ratio] || Film;

  return (
    <button
      onClick={() => onClick(task)}
      className="w-full text-left p-4 rounded-xl border border-border/50 bg-card hover:bg-muted/30 transition-colors space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm text-foreground line-clamp-2">{task.parent_title}</h3>
        <Badge variant="outline" className={cn('shrink-0 text-xs', RENDER_STATUS_COLORS[task.render_status])}>
          {RENDER_STATUS_LABELS[task.render_status]}
        </Badge>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AspectIcon className="w-3.5 h-3.5" />
        <span>{task.aspect_ratio}</span>
        <span>·</span>
        <span>{OUTPUT_TYPE_LABELS[task.requested_output]}</span>
        {task.target_duration && (
          <>
            <span>·</span>
            <span>{task.target_duration}s</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {EDIT_PLAN_STATUS_LABELS[task.edit_plan_status]}
        </Badge>
      </div>

      {task.render_status === 'rendering' && (
        <div className="w-full bg-secondary rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all"
            style={{ width: `${task.render_progress}%` }}
          />
        </div>
      )}
    </button>
  );
}
