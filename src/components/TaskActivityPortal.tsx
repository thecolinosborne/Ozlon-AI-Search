import { CheckCircle2, Circle, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskActivityStore, type TaskStep, type ActiveTask } from "@/stores/useTaskActivityStore";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const StepIcon = ({ status }: { status: TaskStep['status'] }) => {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
    case 'in_progress':
      return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
    case 'error':
      return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />;
    default:
      return <Circle className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
};

const TaskCard = ({ task }: { task: ActiveTask }) => (
  <div className="border border-border rounded-lg p-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {task.status === 'in_progress' ? (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        ) : task.status === 'done' ? (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        ) : (
          <AlertCircle className="w-4 h-4 text-destructive" />
        )}
        <h4 className="font-medium text-sm text-foreground">{task.title}</h4>
      </div>
      <span className="text-xs text-muted-foreground">
        {new Date(task.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>

    {task.steps.length > 0 && (
      <div className="space-y-1.5 pl-1">
        {task.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <StepIcon status={step.status} />
            <span
              className={cn(
                "text-sm",
                step.status === 'done'
                  ? "text-muted-foreground"
                  : step.status === 'in_progress'
                  ? "text-foreground font-medium"
                  : step.status === 'error'
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

/**
 * TaskActivityPortal — reads open state directly from the Zustand store.
 * This is the single source of truth for portal visibility.
 */
export const TaskActivityPortal = () => {
  const { tasks, isPortalOpen, setPortalOpen } = useTaskActivityStore();

  const sortedTasks = [...tasks].reverse();

  return (
    <Sheet open={isPortalOpen} onOpenChange={setPortalOpen}>
      <SheetContent side="bottom" className="max-h-[60vh] rounded-t-2xl pb-safe">
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base">Task Activity</SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto space-y-3 pr-1 max-h-[45vh]">
          {sortedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No active tasks right now.
            </p>
          ) : (
            sortedTasks.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
