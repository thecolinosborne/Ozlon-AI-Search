import { create } from 'zustand';

/**
 * Transient live task activity store.
 * This is UI-only ephemeral state for showing real-time AI work progress
 * in the TaskActivityBubble / TaskActivityPortal overlay.
 *
 * It is NOT the data model for the /tasks page, which is backed by
 * the work_tasks table via useWorkTasks hook.
 */
const isDev = import.meta.env.DEV;

export interface TaskStep {
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'error';
  timestamp: number;
}

export interface ActiveTask {
  id: string;
  title: string;
  status: 'in_progress' | 'done' | 'error';
  steps: TaskStep[];
  startedAt: number;
  completedAt?: number;
  summary?: string;
}

interface TaskActivityState {
  tasks: ActiveTask[];
  isPortalOpen: boolean;
  addTask: (id: string, title: string) => void;
  updateStep: (taskId: string, stepLabel: string, status: TaskStep['status']) => void;
  completeTask: (taskId: string, status?: 'done' | 'error') => void;
  setTaskSummary: (taskId: string, summary: string) => void;
  dismissTask: (taskId: string) => void;
  clearAllTasks: () => void;
  failStaleTasks: (taskIds?: Set<string>) => void;
  setPortalOpen: (open: boolean) => void;
}

export const useTaskActivityStore = create<TaskActivityState>((set) => ({
  tasks: [],
  isPortalOpen: false,

  addTask: (id, title) =>
    set((state) => {
      if (state.tasks.some((t) => t.id === id)) {
        if (isDev) console.warn(`[TaskActivity] Duplicate addTask ignored: ${id}`);
        return state;
      }
      return {
        tasks: [
          ...state.tasks,
          { id, title, status: 'in_progress', steps: [], startedAt: Date.now() },
        ],
      };
    }),

  updateStep: (taskId, stepLabel, status) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        if (t.status === 'done' || t.status === 'error') {
          if (isDev) console.warn(`[TaskActivity] updateStep on completed task "${taskId}" (${t.status}) — ignored.`);
          return t;
        }
        const existingIdx = t.steps.findIndex((s) => s.label === stepLabel);
        if (existingIdx >= 0) {
          const newSteps = [...t.steps];
          newSteps[existingIdx] = { ...newSteps[existingIdx], status, timestamp: Date.now() };
          return { ...t, steps: newSteps };
        }
        return { ...t, steps: [...t.steps, { label: stepLabel, status, timestamp: Date.now() }] };
      }),
    })),

  completeTask: (taskId, status = 'done') =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        // Guard: never transition error → done
        if (t.status === 'error' && status === 'done') {
          if (isDev) console.warn(`[TaskActivity] Blocked error→done transition for task "${taskId}".`);
          return t;
        }
        // Don't re-complete
        if (t.status === 'done' || t.status === 'error') {
          if (isDev) console.warn(`[TaskActivity] completeTask on already-completed "${taskId}" (${t.status}→${status}) — ignored.`);
          return t;
        }
        return { ...t, status, completedAt: Date.now() };
      }),
    })),

  setTaskSummary: (taskId, summary) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, summary } : t
      ),
    })),

  dismissTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    })),

  clearAllTasks: () => set({ tasks: [] }),

  failStaleTasks: (taskIds) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.status !== 'in_progress') return t;
        if (taskIds && !taskIds.has(t.id)) return t;
        if (isDev) console.warn(`[TaskActivity] Failing stale task "${t.id}" (${t.title}).`);
        return { ...t, status: 'error' as const, completedAt: Date.now() };
      }),
    })),

  setPortalOpen: (open) => set({ isPortalOpen: open }),
}));
