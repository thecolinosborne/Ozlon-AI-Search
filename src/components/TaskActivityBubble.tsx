import { useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskActivityStore } from "@/stores/useTaskActivityStore";
import { TaskActivityPortal } from "./TaskActivityPortal";

export const TaskActivityBubble = () => {
  const { tasks, isPortalOpen, setPortalOpen, dismissTask } = useTaskActivityStore();

  const activeTasks = tasks.filter((t) => t.status === 'in_progress');
  const recentDone = tasks.filter(
    (t) => t.status === 'done' && t.completedAt && Date.now() - t.completedAt < (t.summary ? 15000 : 5000)
  );
  const recentError = tasks.filter(
    (t) => t.status === 'error' && t.completedAt && Date.now() - t.completedAt < 8000
  );

  const visibleTasks = [...activeTasks, ...recentDone, ...recentError];

  // Auto-dismiss completed tasks after 5s
  useEffect(() => {
    const completedTasks = tasks.filter(
      (t) => (t.status === 'done' || t.status === 'error') && t.completedAt
    );
    if (!completedTasks.length) return;

    const timer = setTimeout(() => {
      completedTasks.forEach((t) => {
        const threshold = t.summary ? 15000 : 5000;
        if (t.completedAt && Date.now() - t.completedAt >= threshold) {
          dismissTask(t.id);
        }
      });
    }, 5000);

    return () => clearTimeout(timer);
  }, [tasks, dismissTask]);

  if (!visibleTasks.length) return null;

  const currentTask = visibleTasks[0];
  const currentStep = currentTask.steps.filter((s) => s.status === 'in_progress').pop()
    || currentTask.steps[currentTask.steps.length - 1];

  return (
    <>
      <button
        onClick={() => setPortalOpen(true)}
        className={cn(
          "fixed bottom-24 right-4 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-lg transition-all duration-300",
          "bg-background border border-border hover:shadow-xl",
          activeTasks.length > 0 && "animate-pulse"
        )}
      >
        {currentTask.status === 'in_progress' ? (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        ) : currentTask.status === 'done' ? (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        ) : (
          <AlertCircle className="w-4 h-4 text-destructive" />
        )}
        <span className="text-sm font-medium text-foreground max-w-[240px] truncate">
          {currentTask.status === 'in_progress'
            ? currentStep?.label || currentTask.title
            : currentTask.status === 'done'
            ? currentTask.summary || 'Task complete'
            : 'Task failed'}
        </span>
        {visibleTasks.length > 1 && (
          <span className="text-xs text-muted-foreground">+{visibleTasks.length - 1}</span>
        )}
        {currentTask.status !== 'in_progress' && (
          <button
            onClick={(e) => { e.stopPropagation(); dismissTask(currentTask.id); }}
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {activeTasks.length > 0 && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary animate-ping" />
        )}
      </button>

      <TaskActivityPortal open={isPortalOpen} onOpenChange={setPortalOpen} />
    </>
  );
};
