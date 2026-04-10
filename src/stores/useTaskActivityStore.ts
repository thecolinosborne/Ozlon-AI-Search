import { create } from 'zustand';

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
  setPortalOpen: (open: boolean) => void;
}

export const useTaskActivityStore = create<TaskActivityState>((set) => ({
  tasks: [],
  isPortalOpen: false,

  addTask: (id, title) =>
    set((state) => ({
      tasks: [
        ...state.tasks,
        { id, title, status: 'in_progress', steps: [], startedAt: Date.now() },
      ],
    })),

  updateStep: (taskId, stepLabel, status) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
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
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status, completedAt: Date.now() } : t
      ),
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

  setPortalOpen: (open) => set({ isPortalOpen: open }),
}));
