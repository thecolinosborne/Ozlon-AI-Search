import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EditPlanPanel } from './EditPlanPanel';
import type { VideoTaskWithParent, EditPlanAction } from '@/types/video';
import {
  RENDER_STATUS_LABELS, RENDER_STATUS_COLORS,
  SOURCE_TYPE_LABELS, OUTPUT_TYPE_LABELS,
  EDIT_PLAN_STATUS_LABELS,
} from '@/types/video';

interface VideoTaskDetailProps {
  task: VideoTaskWithParent | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<VideoTaskWithParent>) => void;
  onGenerateEditPlan: (instructions: string) => EditPlanAction[];
}

export function VideoTaskDetail({ task, open, onClose, onUpdate, onGenerateEditPlan }: VideoTaskDetailProps) {
  if (!task) return null;

  const handleApprove = () => {
    onUpdate(task.id, { edit_plan_status: 'approved' });
  };

  const handleReject = () => {
    onUpdate(task.id, { edit_plan_status: 'stale' });
  };

  const handleGenerate = () => {
    const plan = onGenerateEditPlan(task.edit_instructions || '');
    onUpdate(task.id, { edit_plan: plan, edit_plan_status: 'generated' });
  };

  const handleToggleAction = (actionId: string) => {
    const updated = task.edit_plan.map(a =>
      a.id === actionId
        ? { ...a, status: a.status === 'done' ? 'pending' : 'done' } as EditPlanAction
        : a
    );
    onUpdate(task.id, { edit_plan: updated });
  };

  const renderHistory = [...(task.render_history || [])].sort((a, b) =>
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{task.parent_title}</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 mt-4">
          {/* Status row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-xs', RENDER_STATUS_COLORS[task.render_status])}>
              {RENDER_STATUS_LABELS[task.render_status]}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {OUTPUT_TYPE_LABELS[task.requested_output]}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {task.aspect_ratio}
            </Badge>
            {task.target_duration && (
              <Badge variant="secondary" className="text-xs">{task.target_duration}s</Badge>
            )}
          </div>

          {/* Render progress */}
          {task.render_status === 'rendering' && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Rendering...</span>
                <span>{task.render_progress}%</span>
              </div>
              <Progress value={task.render_progress} className="h-2" />
            </div>
          )}

          {/* Source content */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">Source</h3>
            <Badge variant="outline" className="text-xs">{SOURCE_TYPE_LABELS[task.source_type]}</Badge>
            {task.source_content && (
              <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap">
                {task.source_content}
              </p>
            )}
          </div>

          {/* Edit instructions */}
          {task.edit_instructions && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Edit Instructions</h3>
              <p className="text-sm text-muted-foreground">{task.edit_instructions}</p>
            </div>
          )}

          <Separator />

          {/* Edit Plan */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">Edit Plan</h3>
            <EditPlanPanel
              plan={task.edit_plan}
              status={task.edit_plan_status}
              onApprove={handleApprove}
              onReject={handleReject}
              onGenerate={handleGenerate}
              onToggleAction={handleToggleAction}
            />
          </div>

          <Separator />

          {/* Render action */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">Render</h3>
            {task.render_status === 'completed' && task.output_url ? (
              <div className="rounded-lg border border-border/50 p-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">Output ready</p>
                <Button size="sm" variant="outline" disabled>
                  <Play className="w-4 h-4 mr-1" /> Preview (Coming Soon)
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                disabled={task.edit_plan_status !== 'approved'}
                className="w-full"
              >
                <Play className="w-4 h-4 mr-1" />
                {task.edit_plan_status !== 'approved' ? 'Approve edit plan first' : 'Start Render (Mock)'}
              </Button>
            )}
          </div>

          {/* Render history */}
          {renderHistory.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Render History</h3>
              <div className="space-y-2">
                {renderHistory.map((entry) => (
                  <div key={entry.id} className="text-xs border border-border/30 rounded-lg p-2 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{new Date(entry.started_at).toLocaleString()}</span>
                      <Badge variant="outline" className="text-xs">{entry.status}</Badge>
                    </div>
                    {entry.error && <p className="text-destructive">{entry.error}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
