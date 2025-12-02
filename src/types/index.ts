// Message types
export interface Message {
  id: string;
  text: string;
  sender: "user" | "assistant";
  timestamp: Date;
  actions?: string[];
  isLoading?: boolean;
}

// User types
export interface User {
  id: string;
  email: string;
  name: string;
  orbName: string;
  communicationMode: "text" | "voice" | "both";
  dailyStructure: "consistent" | "variable" | "mixed";
  priorityDomains: string[];
  existingSystems: string[];
  insightStyle: "direct" | "detailed" | "visual" | "adaptive";
  onboardingComplete: boolean;
}

// Agent types for future extensibility
export interface Agent {
  id: string;
  name: string;
  enabled: boolean;
  status: "active" | "inactive" | "pending";
}

// Dashboard card types
export interface DashboardCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  action: string;
  priority: number;
}

// Connection types
export interface Connection {
  id: string;
  type: "calendar" | "email" | "banking";
  name: string;
  connected: boolean;
  lastSync?: Date;
}

// Voice recording state
export interface VoiceState {
  isRecording: boolean;
  isPlaying: boolean;
  audioQueue: string[];
}

// App state
export interface AppState {
  // User
  user: User | null;
  isAuthenticated: boolean;
  
  // Messages (last 10 for short-term memory)
  messages: Message[];
  
  // Voice
  voiceState: VoiceState;
  
  // Agents
  agents: Agent[];
  
  // Connections
  connections: Connection[];
  
  // UI
  isLoading: boolean;
  isOffline: boolean;
  pendingMessages: Message[];
}
