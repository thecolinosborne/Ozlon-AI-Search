/**
 * AI Service Layer - Agent-Expandable Architecture
 * 
 * This module provides a centralized AI service layer that:
 * - Routes requests to appropriate models
 * - Manages tool/action registries
 * - Handles agent context and metadata
 * - Supports future agent expansions
 */

import { 
  streamChat, 
  AVAILABLE_MODELS, 
  AVAILABLE_AGENTS,
} from '@/services/chatService';
import type { 
  Message, 
  AgentMetadata, 
  ModelId, 
  AgentId,
} from '@/services/chatService';

// Re-export types and constants
export { AVAILABLE_MODELS, AVAILABLE_AGENTS };
export type { Message, AgentMetadata, ModelId, AgentId };

// ============================================================================
// TOOL/ACTION REGISTRY
// ============================================================================

export interface ToolSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
  }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  permissions?: string[];
  uiCallback?: (result: unknown) => void;
}

// Global tool registry
const toolRegistry: Map<string, ToolDefinition> = new Map();

/**
 * Register a tool in the global registry
 */
export function registerTool(tool: ToolDefinition): void {
  toolRegistry.set(tool.name, tool);
  console.log(`Tool registered: ${tool.name}`);
}

/**
 * Unregister a tool from the registry
 */
export function unregisterTool(toolName: string): boolean {
  return toolRegistry.delete(toolName);
}

/**
 * Get a tool by name
 */
export function getTool(toolName: string): ToolDefinition | undefined {
  return toolRegistry.get(toolName);
}

/**
 * Get all registered tools
 */
export function getAllTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string, 
  args: Record<string, unknown>
): Promise<unknown> {
  const tool = toolRegistry.get(toolName);
  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }
  return tool.handler(args);
}

// ============================================================================
// AGENT CONTEXT MANAGEMENT
// ============================================================================

export interface AgentContext {
  agentId: AgentId;
  model: ModelId;
  systemName: string;
  intent?: string;
  memory?: Record<string, unknown>;
  activeTools?: string[];
  metadata?: Record<string, unknown>;
}

const defaultAgentContext: AgentContext = {
  agentId: 'base',
  model: 'gpt-4.1',
  systemName: 'Ozlon',
};

let currentAgentContext: AgentContext = { ...defaultAgentContext };

/**
 * Set the current agent context
 */
export function setAgentContext(context: Partial<AgentContext>): void {
  currentAgentContext = { ...currentAgentContext, ...context };
}

/**
 * Get the current agent context
 */
export function getAgentContext(): AgentContext {
  return { ...currentAgentContext };
}

/**
 * Reset agent context to defaults
 */
export function resetAgentContext(): void {
  currentAgentContext = { ...defaultAgentContext };
}

// ============================================================================
// AI SERVICE - Main interface for AI interactions
// ============================================================================

export interface ChatOptions {
  messages: Message[];
  intent?: string;
  systemName?: string;
  model?: ModelId;
  agentId?: AgentId;
  agentMetadata?: AgentMetadata;
  enableTools?: boolean;
  onDelta: (content: string) => void;
  onToolCall?: (toolName: string, toolArgs: Record<string, unknown>) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

/**
 * Send a chat message through the AI service
 * This is the main entry point for all AI interactions
 */
export async function chat(options: ChatOptions): Promise<void> {
  const context = getAgentContext();
  
  return streamChat({
    messages: options.messages,
    intent: options.intent || context.intent,
    systemName: options.systemName || context.systemName,
    model: options.model || context.model,
    agentId: options.agentId || context.agentId,
    agentMetadata: options.agentMetadata,
    enableTools: options.enableTools ?? false,
    onDelta: options.onDelta,
    onToolCall: async (toolName, toolArgs) => {
      // Try to execute the tool locally first
      const tool = getTool(toolName);
      if (tool) {
        try {
          const result = await tool.handler(toolArgs);
          tool.uiCallback?.(result);
        } catch (error) {
          console.error(`Tool execution failed: ${toolName}`, error);
        }
      }
      // Also notify the caller
      options.onToolCall?.(toolName, toolArgs);
    },
    onDone: options.onDone,
    onError: options.onError,
  });
}

/**
 * Switch to a different agent
 */
export function switchAgent(agentId: AgentId): void {
  setAgentContext({ agentId });
  console.log(`Switched to agent: ${agentId}`);
}

/**
 * Switch to a different model
 */
export function switchModel(model: ModelId): void {
  setAgentContext({ model });
  console.log(`Switched to model: ${model}`);
}

/**
 * Get model info
 */
export function getModelInfo(modelId: ModelId) {
  return AVAILABLE_MODELS[modelId];
}

/**
 * Get agent info
 */
export function getAgentInfo(agentId: AgentId) {
  return AVAILABLE_AGENTS[agentId];
}
