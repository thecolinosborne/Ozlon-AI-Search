import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
  resetAll: () => void;
}

const defaultState: IntegrationState = {
  status: "disconnected",
  lastSync: null,
  syncDirection: "two-way",
  apiKeyConfigured: false,
  settings: {},
};

// User-scoped persist key. Default (anon) is a sentinel so signed-out users get a clean slate.
const STORE_PREFIX = "ozlon-integrations";
function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem("ozlon_active_user_id");
    return raw || "anon";
  } catch {
    return "anon";
  }
}
function storageName(): string {
  return `${STORE_PREFIX}:${getCurrentUserId()}`;
}

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
      resetAll: () => set({ integrations: {} }),
    }),
    {
      name: storageName(),
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/** Wipe ALL persisted integration caches (used at signout). */
export function clearAllIntegrationCaches(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${STORE_PREFIX}:`)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    localStorage.removeItem("ozlon_active_user_id");
    useIntegrationsStore.getState().resetAll();
  } catch {
    /* ignore */
  }
}

/** Switch the persisted-store namespace when the active user changes. */
export function setActiveIntegrationsUser(userId: string | null): void {
  try {
    const id = userId || "anon";
    const prev = localStorage.getItem("ozlon_active_user_id");
    if (prev === id) return;
    localStorage.setItem("ozlon_active_user_id", id);
    // Reset in-memory state and rehydrate from the new namespaced key.
    useIntegrationsStore.getState().resetAll();
    // @ts-expect-error zustand persist API exposes setOptions / rehydrate at runtime
    useIntegrationsStore.persist?.setOptions?.({ name: `${STORE_PREFIX}:${id}` });
    // @ts-expect-error rehydrate is exposed by persist middleware
    useIntegrationsStore.persist?.rehydrate?.();
  } catch {
    /* ignore */
  }
}
