import { create } from "zustand";
import { persist } from "zustand/middleware";

export type IntegrationStatus = "connected" | "disconnected" | "syncing" | "error";
export type SyncDirection = "two-way" | "inbound" | "outbound";

export interface IntegrationState {
  status: IntegrationStatus;
  lastSync: string | null;
  syncDirection: SyncDirection;
  apiKeyConfigured: boolean;
  settings: Record<string, unknown>;
}

interface IntegrationsStore {
  integrations: Record<string, IntegrationState>;
  getIntegration: (id: string) => IntegrationState;
  setStatus: (id: string, status: IntegrationStatus) => void;
  setSyncDirection: (id: string, direction: SyncDirection) => void;
  setLastSync: (id: string, time: string) => void;
  setApiKeyConfigured: (id: string, configured: boolean) => void;
  updateSettings: (id: string, settings: Record<string, unknown>) => void;
  disconnect: (id: string) => void;
}

const defaultState: IntegrationState = {
  status: "disconnected",
  lastSync: null,
  syncDirection: "two-way",
  apiKeyConfigured: false,
  settings: {},
};

export const useIntegrationsStore = create<IntegrationsStore>()(
  persist(
    (set, get) => ({
      integrations: {},
      getIntegration: (id) => get().integrations[id] || { ...defaultState },
      setStatus: (id, status) =>
        set((s) => ({
          integrations: {
            ...s.integrations,
            [id]: { ...(s.integrations[id] || defaultState), status },
          },
        })),
      setSyncDirection: (id, direction) =>
        set((s) => ({
          integrations: {
            ...s.integrations,
            [id]: { ...(s.integrations[id] || defaultState), syncDirection: direction },
          },
        })),
      setLastSync: (id, time) =>
        set((s) => ({
          integrations: {
            ...s.integrations,
            [id]: { ...(s.integrations[id] || defaultState), lastSync: time },
          },
        })),
      setApiKeyConfigured: (id, configured) =>
        set((s) => ({
          integrations: {
            ...s.integrations,
            [id]: { ...(s.integrations[id] || defaultState), apiKeyConfigured: configured },
          },
        })),
      updateSettings: (id, settings) =>
        set((s) => ({
          integrations: {
            ...s.integrations,
            [id]: {
              ...(s.integrations[id] || defaultState),
              settings: { ...(s.integrations[id]?.settings || {}), ...settings },
            },
          },
        })),
      disconnect: (id) =>
        set((s) => ({
          integrations: {
            ...s.integrations,
            [id]: { ...defaultState },
          },
        })),
    }),
    { name: "ozlon-integrations" }
  )
);
