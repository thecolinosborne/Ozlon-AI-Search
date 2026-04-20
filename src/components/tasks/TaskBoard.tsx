import { useCallback } from 'react';
import { WorkTask, TaskStatus, STATUS_ORDER, STATUS_LABELS } from '@/hooks/useWorkTasks';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';

interface TaskBoardProps {
  tasks: WorkTask[];
  onTaskClick: (task: WorkTask) => void;
  onMoveTask: (taskId: string, newStatus: TaskStatus, newPosition: number) => void;
}

const COLUMN_STYLES: Record<TaskStatus, string> = {
  todo: 'border-muted-foreground/20',
  in_progress: 'border-primary/30',
  done: 'border-green-500/30',
};

export function TaskBoard({ tasks, onTaskClick, onMoveTask }: TaskBoardProps) {
  const getColumnTasks = useCallback((status: TaskStatus) => {
    return tasks
      .filter(t => t.status === status)
      .sort((a, b) => a.board_position - b.board_position);
  }, [tasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;
    const columnTasks = getColumnTasks(status);
    onMoveTask(taskId, status, columnTasks.length);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">
      {STATUS_ORDER.map(status => {
        const columnTasks = getColumnTasks(status);
        return (
          <div
            key={status}
            className={cn('flex flex-col rounded-xl border bg-muted/20 min-h-[200px]', COLUMN_STYLES[status])}
            onDrop={(e) => handleDrop(e, status)}
            onDragOver={handleDragOver}
          >
            <div className="px-3 py-2 border-b border-border/30">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {STATUS_LABELS[status]}
                </h3>
                <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                  {columnTasks.length}
                </span>
              </div>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {columnTasks.map(task => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <TaskCard task={task} onClick={onTaskClick} />
                </div>
              ))}
              {columnTasks.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8 italic">
                  Drop tasks here
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
