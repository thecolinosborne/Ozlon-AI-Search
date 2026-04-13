import { Check, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { EditPlanAction, EditPlanStatus } from '@/types/video';
import { EDIT_PLAN_STATUS_LABELS } from '@/types/video';

interface EditPlanPanelProps {
  plan: EditPlanAction[];
  status: EditPlanStatus;
  onApprove: () => void;
  onReject: () => void;
  onGenerate: () => void;
  onToggleAction: (actionId: string) => void;
}

const phaseLabels: Record<string, string> = {
  pre: 'Pre-production',
  main: 'Production',
  post: 'Post-production',
};

export function EditPlanPanel({ plan, status, onApprove, onReject, onGenerate, onToggleAction }: EditPlanPanelProps) {
  if (status === 'not_generated') {
    return (
      <div className="rounded-lg border border-dashed border-border/50 p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">No edit plan generated yet.</p>
        <Button size="sm" onClick={onGenerate}>Generate Edit Plan</Button>
      </div>
    );
  }

  const phases = ['pre', 'main', 'post'] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-xs">
          {EDIT_PLAN_STATUS_LABELS[status]}
        </Badge>
        <div className="flex gap-2">
          {status === 'generated' && (
            <>
              <Button size="sm" variant="outline" onClick={onReject} className="gap-1">
                <X className="w-3.5 h-3.5" /> Reject
              </Button>
              <Button size="sm" onClick={onApprove} className="gap-1">
                <Check className="w-3.5 h-3.5" /> Approve
              </Button>
            </>
          )}
          {status === 'stale' && (
            <Button size="sm" variant="outline" onClick={onGenerate} className="gap-1">
              <RotateCcw className="w-3.5 h-3.5" /> Regenerate
            </Button>
          )}
        </div>
      </div>

      {phases.map(phase => {
        const actions = plan.filter(a => a.phase === phase);
        if (actions.length === 0) return null;
        return (
          <div key={phase} className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {phaseLabels[phase]}
            </h4>
            {actions.map(action => (
              <button
                key={action.id}
                onClick={() => onToggleAction(action.id)}
                className={cn(
                  'w-full flex items-start gap-3 p-3 rounded-lg border transition-colors text-left',
                  action.status === 'done'
                    ? 'border-primary/30 bg-primary/5'
                    : action.status === 'skipped'
                    ? 'border-border/30 bg-muted/30 opacity-50'
                    : 'border-border/50 hover:bg-muted/20'
                )}
              >
                <div className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5',
                  action.status === 'done' ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                )}>
                  {action.status === 'done' && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{action.label}</p>
                  <p className="text-xs text-muted-foreground">{action.detail}</p>
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
