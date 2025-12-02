import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Message, User, Agent, Connection, VoiceState } from "@/types";

interface AppStore {
  // User state
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  updateUser: (updates: Partial<User>) => void;
  
  // Messages (maintains last 10 for context)
  messages: Message[];
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  clearMessages: () => void;
  
  // Voice state
  voiceState: VoiceState;
  setRecording: (isRecording: boolean) => void;
  setPlaying: (isPlaying: boolean) => void;
  addToAudioQueue: (audio: string) => void;
  clearAudioQueue: () => void;
  
  // Agents
  agents: Agent[];
  toggleAgent: (id: string) => void;
  
  // Connections
  connections: Connection[];
  updateConnection: (id: string, connected: boolean) => void;
  
  // UI state
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  isOffline: boolean;
  setOffline: (offline: boolean) => void;
  
  // Pending messages (offline queue)
  pendingMessages: Message[];
  addPendingMessage: (message: Message) => void;
  clearPendingMessages: () => void;
  
  // Reset
  reset: () => void;
}

const defaultAgents: Agent[] = [
  { id: "memory", name: "Memory", enabled: false, status: "pending" },
  { id: "orchestration", name: "Orchestration", enabled: false, status: "pending" },
  { id: "communication", name: "Communication", enabled: false, status: "pending" },
  { id: "personality", name: "Personality", enabled: false, status: "pending" },
  { id: "banking", name: "Banking", enabled: false, status: "pending" },
  { id: "summary", name: "Summary", enabled: false, status: "pending" },
];

const defaultConnections: Connection[] = [
  { id: "calendar", type: "calendar", name: "Calendar", connected: false },
  { id: "email", type: "email", name: "Email", connected: false },
  { id: "banking", type: "banking", name: "Banking", connected: false },
];

const initialState = {
  user: null,
  isAuthenticated: false,
  messages: [],
  voiceState: { isRecording: false, isPlaying: false, audioQueue: [] },
  agents: defaultAgents,
  connections: defaultConnections,
  isLoading: false,
  isOffline: false,
  pendingMessages: [],
};

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      
      updateUser: (updates) => set((state) => ({
        user: state.user ? { ...state.user, ...updates } : null,
      })),
      
      addMessage: (message) => set((state) => {
        const newMessages = [...state.messages, message];
        // Keep only last 10 messages for short-term memory
        return { messages: newMessages.slice(-10) };
      }),
      
      updateMessage: (id, updates) => set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, ...updates } : m
        ),
      })),
      
      clearMessages: () => set({ messages: [] }),
      
      setRecording: (isRecording) => set((state) => ({
        voiceState: { ...state.voiceState, isRecording },
      })),
      
      setPlaying: (isPlaying) => set((state) => ({
        voiceState: { ...state.voiceState, isPlaying },
      })),
      
      addToAudioQueue: (audio) => set((state) => ({
        voiceState: {
          ...state.voiceState,
          audioQueue: [...state.voiceState.audioQueue, audio],
        },
      })),
      
      clearAudioQueue: () => set((state) => ({
        voiceState: { ...state.voiceState, audioQueue: [] },
      })),
      
      toggleAgent: (id) => set((state) => ({
        agents: state.agents.map((a) =>
          a.id === id ? { ...a, enabled: !a.enabled } : a
        ),
      })),
      
      updateConnection: (id, connected) => set((state) => ({
        connections: state.connections.map((c) =>
          c.id === id ? { ...c, connected, lastSync: connected ? new Date() : undefined } : c
        ),
      })),
      
      setLoading: (isLoading) => set({ isLoading }),
      
      setOffline: (isOffline) => set({ isOffline }),
      
      addPendingMessage: (message) => set((state) => ({
        pendingMessages: [...state.pendingMessages, message],
      })),
      
      clearPendingMessages: () => set({ pendingMessages: [] }),
      
      reset: () => set(initialState),
    }),
    {
      name: "ozlon-storage",
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        messages: state.messages,
        agents: state.agents,
        connections: state.connections,
      }),
    }
  )
);
