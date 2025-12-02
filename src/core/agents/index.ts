// ============================================
// OZLON ORB OS - AGENT REGISTRY & BASE INTERFACE
// ============================================
// Universal agent interface and default agent registrations.
// All agents are EMPTY STUBS for external AI stack integration.

import { registerAgent } from "../registry";
import type { AgentConfig, AgentInput, AgentOutput, AgentContext } from "../types";

// ============================================
// UNIVERSAL AGENT INTERFACE
// ============================================

/**
 * Base agent interface that all agents must implement
 * @stub Actual agents would extend this interface
 */
export interface Agent {
  config: AgentConfig;
  
  /**
   * Execute the agent with given input
   * @param input - The input data for the agent
   */
  execute(input: AgentInput): Promise<AgentOutput>;
  
  /**
   * Observe an event (passive monitoring)
   * @param event - The event to observe
   */
  observe(event: { type: string; data: unknown }): Promise<void>;
  
  /**
   * Execute as part of a routine
   * @param context - Routine context
   */
  routine(context: AgentContext): Promise<AgentOutput>;
}

// ============================================
// AGENT EXECUTION STUB
// ============================================

/**
 * Run an agent by ID
 * @stub Replace with actual agent execution
 * 
 * @example
 * const result = await runAgent("finance-agent", {
 *   type: "text",
 *   content: "Analyze my spending this month"
 * });
 */
export async function runAgent(
  agentName: string,
  input: unknown
): Promise<AgentOutput> {
  console.log("[Agent] runAgent called - STUB", { agentName, input });
  
  // STUB: Would invoke actual agent logic
  return {
    agentId: agentName,
    success: false,
    message: `[STUB] Agent "${agentName}" ready for integration`,
    data: null,
  };
}

// ============================================
// DEFAULT AGENT CONFIGURATIONS
// ============================================

const defaultAgents: AgentConfig[] = [
  {
    id: "scheduling-agent",
    name: "Scheduling Agent",
    description: "Manages calendar, meetings, and time optimization",
    version: "1.0.0",
    enabled: true,
    category: "scheduling",
    capabilities: [
      "calendar-analysis",
      "meeting-scheduling",
      "time-blocking",
      "conflict-detection",
      "smart-rescheduling",
    ],
  },
  {
    id: "finance-agent",
    name: "Finance Agent",
    description: "Analyzes spending, tracks bills, detects opportunities",
    version: "1.0.0",
    enabled: true,
    category: "finance",
    capabilities: [
      "spending-analysis",
      "bill-tracking",
      "subscription-detection",
      "savings-opportunities",
      "budget-insights",
    ],
  },
  {
    id: "communication-agent",
    name: "Communication Agent",
    description: "Manages emails, messages, and communication patterns",
    version: "1.0.0",
    enabled: true,
    category: "communication",
    capabilities: [
      "email-triage",
      "message-prioritization",
      "draft-generation",
      "follow-up-reminders",
      "communication-insights",
    ],
  },
  {
    id: "knowledge-agent",
    name: "Knowledge Agent",
    description: "Manages documents, notes, and knowledge extraction",
    version: "1.0.0",
    enabled: true,
    category: "knowledge",
    capabilities: [
      "document-summarization",
      "knowledge-extraction",
      "note-organization",
      "research-assistance",
      "memory-recall",
    ],
  },
  {
    id: "search-agent",
    name: "Search Agent",
    description: "Performs research and information retrieval",
    version: "1.0.0",
    enabled: true,
    category: "search",
    capabilities: [
      "web-search",
      "local-search",
      "semantic-search",
      "research-synthesis",
      "source-validation",
    ],
  },
  {
    id: "personality-agent",
    name: "Personality Agent",
    description: "Manages tone, style, and communication preferences",
    version: "1.0.0",
    enabled: true,
    category: "personality",
    capabilities: [
      "tone-adaptation",
      "style-matching",
      "preference-learning",
      "response-customization",
    ],
  },
  {
    id: "opportunity-agent",
    name: "Opportunity Agent",
    description: "Detects opportunities and weak signals",
    version: "1.0.0",
    enabled: true,
    category: "opportunity",
    capabilities: [
      "opportunity-detection",
      "weak-signal-analysis",
      "trend-identification",
      "recommendation-generation",
    ],
  },
  {
    id: "pattern-agent",
    name: "Pattern Agent",
    description: "Analyzes patterns and behaviors",
    version: "1.0.0",
    enabled: true,
    category: "pattern",
    capabilities: [
      "behavior-analysis",
      "habit-detection",
      "anomaly-detection",
      "trend-analysis",
      "prediction",
    ],
  },
  {
    id: "context-agent",
    name: "Context Agent",
    description: "Maintains situational awareness and context",
    version: "1.0.0",
    enabled: true,
    category: "context",
    capabilities: [
      "context-tracking",
      "situation-awareness",
      "intent-inference",
      "relevance-scoring",
    ],
  },
  {
    id: "memory-agent",
    name: "Memory Agent",
    description: "Manages long-term memory and recall",
    version: "1.0.0",
    enabled: true,
    category: "memory",
    capabilities: [
      "memory-storage",
      "memory-retrieval",
      "memory-consolidation",
      "relevant-recall",
      "memory-pruning",
    ],
  },
  {
    id: "health-agent",
    name: "Health Agent",
    description: "Tracks health metrics and wellness",
    version: "1.0.0",
    enabled: false, // Disabled by default
    category: "health",
    capabilities: [
      "health-tracking",
      "sleep-analysis",
      "activity-monitoring",
      "wellness-insights",
      "habit-recommendations",
    ],
  },
  {
    id: "relationship-agent",
    name: "Relationship Agent",
    description: "Manages contacts and social insights",
    version: "1.0.0",
    enabled: false, // Disabled by default
    category: "relationship",
    capabilities: [
      "contact-management",
      "relationship-tracking",
      "social-insights",
      "birthday-reminders",
      "interaction-history",
    ],
  },
];

// ============================================
// REGISTER DEFAULT AGENTS
// ============================================

export function registerDefaultAgents(): void {
  defaultAgents.forEach(registerAgent);
  console.log(`[Agents] ${defaultAgents.length} default agents registered`);
}

// ============================================
// AGENT UTILITIES
// ============================================

/**
 * Create a custom agent configuration
 */
export function createAgentConfig(
  partial: Partial<AgentConfig> & { id: string; name: string }
): AgentConfig {
  return {
    description: "",
    version: "1.0.0",
    enabled: true,
    category: "custom",
    capabilities: [],
    ...partial,
  };
}
