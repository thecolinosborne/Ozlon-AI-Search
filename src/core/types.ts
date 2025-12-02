// ============================================
// OZLON ORB OS - CORE TYPE DEFINITIONS
// ============================================
// This file defines all core types for the modular OS architecture.
// All types are designed to be extensible and pluggable.

// ============================================
// AGENT SYSTEM TYPES
// ============================================

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  category: AgentCategory;
  capabilities: string[];
  settings?: Record<string, unknown>;
}

export type AgentCategory =
  | "scheduling"
  | "finance"
  | "communication"
  | "knowledge"
  | "search"
  | "personality"
  | "opportunity"
  | "pattern"
  | "context"
  | "memory"
  | "health"
  | "relationship"
  | "custom";

export interface AgentInput {
  type: "text" | "voice" | "image" | "document" | "event" | "routine";
  content: unknown;
  context?: AgentContext;
  metadata?: Record<string, unknown>;
}

export interface AgentOutput {
  agentId: string;
  success: boolean;
  data?: unknown;
  message?: string;
  actions?: AgentAction[];
  confidence?: number;
}

export interface AgentAction {
  type: string;
  label: string;
  payload?: unknown;
}

export interface AgentContext {
  userId?: string;
  sessionId?: string;
  conversationHistory?: unknown[];
  userPreferences?: UserPreferences;
  timestamp: Date;
}

// ============================================
// DASHBOARD CARD TYPES
// ============================================

export interface CardConfig {
  id: string;
  name: string;
  description: string;
  category: CardCategory;
  component: string; // Component identifier for dynamic loading
  size: "small" | "medium" | "large" | "full";
  priority: number;
  enabled: boolean;
  refreshInterval?: number; // ms
  dataSource?: string; // Hook name for data
}

export type CardCategory =
  | "time"
  | "money"
  | "health"
  | "relationship"
  | "knowledge"
  | "opportunity"
  | "custom";

export interface CardData {
  cardId: string;
  loading: boolean;
  error?: string;
  data?: unknown;
  lastUpdated?: Date;
}

// ============================================
// INTEGRATION HOOK TYPES
// ============================================

export interface HookConfig {
  id: string;
  name: string;
  description: string;
  category: HookCategory;
  enabled: boolean;
  handler: HookHandler;
  schema?: Record<string, unknown>; // Input schema
}

export type HookCategory =
  | "reality"
  | "multimodal"
  | "routine"
  | "integration"
  | "custom";

export type HookHandler = (input: unknown) => Promise<unknown>;

// ============================================
// ORCHESTRATOR TYPES
// ============================================

export interface OrchestratorConfig {
  mode: "sequential" | "parallel" | "smart";
  timeout: number;
  maxAgents: number;
  aggregationStrategy: "merge" | "best" | "all";
}

export interface OrchestratorRequest {
  id: string;
  intent: string;
  input: AgentInput;
  targetAgents?: string[]; // Specific agents to route to
  priority?: "low" | "normal" | "high" | "critical";
}

export interface OrchestratorResponse {
  requestId: string;
  success: boolean;
  responses: AgentOutput[];
  aggregatedData?: unknown;
  executionTime: number;
}

// ============================================
// ROUTINE TYPES
// ============================================

export interface RoutineConfig {
  id: string;
  name: string;
  description: string;
  type: RoutineType;
  schedule?: string; // Cron expression or preset
  enabled: boolean;
  agents: string[]; // Agents to invoke
  actions: RoutineAction[];
}

export type RoutineType =
  | "morning"
  | "midday"
  | "evening"
  | "weekly"
  | "monthly"
  | "custom";

export interface RoutineAction {
  type: string;
  config?: Record<string, unknown>;
}

// ============================================
// USER & PERSONALITY TYPES
// ============================================

export interface UserPreferences {
  tone: "formal" | "casual" | "friendly" | "professional";
  verbosity: "minimal" | "balanced" | "detailed";
  formality: number; // 0-100
  assertiveness: number; // 0-100
  creativity: number; // 0-100
  proactiveLevel: "passive" | "balanced" | "proactive";
}

export interface MemorySettings {
  calendar: boolean;
  email: boolean;
  browsing: boolean;
  location: boolean;
  wearable: boolean;
  voice: boolean;
  documents: boolean;
  transactions: boolean;
}

// ============================================
// COMMAND PALETTE TYPES
// ============================================

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  shortcut?: string;
  category: string;
  handler: () => void | Promise<void>;
}

// ============================================
// PLUGIN TYPES
// ============================================

export interface PluginConfig {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  agents?: AgentConfig[];
  cards?: CardConfig[];
  hooks?: HookConfig[];
  commands?: Command[];
}
