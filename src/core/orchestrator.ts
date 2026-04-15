// ============================================
// OZLON ORB OS - MULTI-AGENT ORCHESTRATOR
// ============================================
// The orchestrator routes requests to agents, aggregates outputs,
// and manages the flow of intelligence through the system.

import type {
  OrchestratorConfig,
  OrchestratorRequest,
  OrchestratorResponse,
  AgentInput,
  AgentOutput,
  AgentContext,
  IntentClassification,
  OrchestratorDecision,
} from "./types";
import { getAgent, getEnabledAgents } from "./registry";

// Default orchestrator configuration
const defaultConfig: OrchestratorConfig = {
  mode: "smart",
  timeout: 30000,
  maxAgents: 5,
  aggregationStrategy: "merge",
};

let currentConfig = { ...defaultConfig };

// ============================================
// ORCHESTRATOR CONFIGURATION
// ============================================

/**
 * Configure the orchestrator behavior
 */
export function configureOrchestrator(config: Partial<OrchestratorConfig>): void {
  currentConfig = { ...currentConfig, ...config };
  console.log("[Orchestrator] Configuration updated:", currentConfig);
}

export function getOrchestratorConfig(): OrchestratorConfig {
  return { ...currentConfig };
}

const INTENT_RULES: Array<{
  intent: string;
  keywords: string[];
  agents: string[];
}> = [
  {
    intent: "finance",
    keywords: ["money", "spend", "finance", "budget", "revenue", "invoice"],
    agents: ["finance-agent"],
  },
  {
    intent: "scheduling",
    keywords: ["schedule", "calendar", "meeting", "reschedule", "availability"],
    agents: ["scheduling-agent"],
  },
  {
    intent: "communication",
    keywords: ["email", "message", "contact", "reply", "follow up", "dm"],
    agents: ["communication-agent"],
  },
  {
    intent: "search",
    keywords: ["search", "find", "research", "look up", "discover"],
    agents: ["search-agent"],
  },
  {
    intent: "memory",
    keywords: ["remember", "memory", "recall", "what did i", "history"],
    agents: ["memory-agent"],
  },
];

const TOOL_VERBS = ["send", "create", "update", "delete", "book", "schedule", "sync", "post", "publish", "call"];
const CLARIFYING_PHRASES = ["not sure", "something", "whatever", "anything", "idk"];

// ============================================
// INTENT CLASSIFICATION
// ============================================

/**
 * Classify user intent to determine which agents to route to
 * Heuristic classifier used until LLM router is introduced.
 */
export async function classifyIntent(input: string): Promise<IntentClassification> {
  console.log("[Orchestrator] classifyIntent called", { input });

  const lowerInput = input.toLowerCase();

  for (const rule of INTENT_RULES) {
    const matches = rule.keywords.filter((keyword) => lowerInput.includes(keyword)).length;
    if (matches > 0) {
      const confidence = Math.min(0.95, 0.55 + matches * 0.15);
      return {
        intent: rule.intent,
        confidence,
        suggestedAgents: rule.agents,
      };
    }
  }

  return {
    intent: "general",
    confidence: 0.4,
    suggestedAgents: ["context-agent"],
  };
}

/**
 * Decide whether to answer directly, ask clarifying questions, or run tools.
 */
export function decideOrchestratorAction(
  userInput: string,
  classification: IntentClassification,
): OrchestratorDecision {
  const lowerInput = userInput.toLowerCase();
  const missingContext: string[] = [];

  const likelyNeedsTool = TOOL_VERBS.some((verb) => lowerInput.includes(verb));
  const potentiallyAmbiguous = CLARIFYING_PHRASES.some((phrase) => lowerInput.includes(phrase));
  const shortAndVague = userInput.trim().split(/\s+/).length < 4;

  if (classification.confidence < 0.5 || potentiallyAmbiguous || shortAndVague) {
    missingContext.push("goal", "target system", "desired output");
    return {
      action: "clarify",
      confidence: Math.max(0.2, classification.confidence),
      reason: "Input is ambiguous or low-confidence; ask clarifying question first.",
      missingContext,
    };
  }

  if (likelyNeedsTool) {
    return {
      action: "run_tools",
      confidence: classification.confidence,
      reason: "User request appears actionable and requires integrations/tool execution.",
    };
  }

  return {
    action: "answer",
    confidence: classification.confidence,
    reason: "User request is informational and can be answered directly.",
  };
}

// ============================================
// REQUEST ROUTING
// ============================================

/**
 * Route a request to appropriate agents
 * @stub Replace agent.execute with actual agent invocation
 */
export async function routeRequest(
  request: OrchestratorRequest
): Promise<OrchestratorResponse> {
  const startTime = Date.now();
  console.log("[Orchestrator] routeRequest called", { requestId: request.id, intent: request.intent });
  const classification = await classifyIntent(request.intent);
  const decision = decideOrchestratorAction(request.intent, classification);

  if (decision.action === "clarify") {
    return {
      requestId: request.id,
      success: true,
      responses: [
        {
          agentId: "context-agent",
          success: true,
          message: "I need a bit more detail before acting. Tell me the exact goal and desired output.",
          confidence: decision.confidence,
        },
      ],
      aggregatedData: {
        followUpPrompt:
          "Can you share the exact outcome you want, which app/system to use, and any deadline?",
        missingContext: decision.missingContext || [],
      },
      executionTime: Date.now() - startTime,
      decision,
      classification,
    };
  }

  // Determine which agents to invoke
  let targetAgentIds = request.targetAgents;
  
  if (!targetAgentIds || targetAgentIds.length === 0) {
    targetAgentIds = classification.suggestedAgents;
  }

  // Limit agents based on config
  targetAgentIds = targetAgentIds.slice(0, currentConfig.maxAgents);

  // Execute agents (stub - actual execution would happen here)
  const responses: AgentOutput[] = await executeAgents(targetAgentIds, request.input);

  // Aggregate responses
  const aggregatedData = aggregateResponses(responses, currentConfig.aggregationStrategy);

  return {
    requestId: request.id,
    success: responses.some((r) => r.success),
    responses,
    aggregatedData,
    executionTime: Date.now() - startTime,
    decision,
    classification,
  };
}

// ============================================
// AGENT EXECUTION (STUB)
// ============================================

/**
 * Execute multiple agents with the given input
 * @stub This should invoke actual agent logic
 */
async function executeAgents(
  agentIds: string[],
  input: AgentInput
): Promise<AgentOutput[]> {
  console.log("[Orchestrator] executeAgents called - STUB", { agentIds });

  // STUB: Each agent would have its own execute method
  const results: AgentOutput[] = agentIds.map((agentId) => {
    const agent = getAgent(agentId);
    
    // Placeholder response
    return {
      agentId,
      success: !!agent,
      data: null, // STUB: Would contain actual agent output
      message: agent 
        ? `[STUB] Agent "${agent.name}" ready for integration`
        : `Agent "${agentId}" not found`,
      confidence: agent ? 0.5 : 0,
    };
  });

  return results;
}

// ============================================
// RESPONSE AGGREGATION
// ============================================

/**
 * Aggregate multiple agent responses
 * @stub Replace with actual aggregation logic
 */
function aggregateResponses(
  responses: AgentOutput[],
  strategy: "merge" | "best" | "all"
): unknown {
  console.log("[Orchestrator] aggregateResponses called - STUB", { strategy });

  switch (strategy) {
    case "best":
      // Return the response with highest confidence
      return responses.reduce((best, current) =>
        (current.confidence || 0) > (best.confidence || 0) ? current : best
      );
    
    case "all":
      // Return all responses as-is
      return responses;
    
    case "merge":
    default:
      // STUB: Would intelligently merge responses
      return {
        merged: true,
        responseCount: responses.length,
        successCount: responses.filter((r) => r.success).length,
        // Additional merged data would go here
      };
  }
}

// ============================================
// DISPATCH TASK (STUB)
// ============================================

/**
 * Dispatch a task to a specific agent
 * @stub Replace with actual task dispatch
 */
export async function dispatchTask(
  agentId: string,
  task: { type: string; payload: unknown }
): Promise<AgentOutput> {
  console.log("[Orchestrator] dispatchTask called - STUB", { agentId, taskType: task.type });

  const agent = getAgent(agentId);
  if (!agent) {
    return {
      agentId,
      success: false,
      message: `Agent not found: ${agentId}`,
    };
  }

  // STUB: Actual task execution would happen here
  return {
    agentId,
    success: true,
    data: null,
    message: `[STUB] Task "${task.type}" dispatched to "${agent.name}"`,
  };
}

// ============================================
// SCHEDULE ROUTINE (STUB)
// ============================================

/**
 * Schedule a recurring routine
 * @stub Replace with actual scheduling logic
 */
export function scheduleRoutine(
  routineId: string,
  schedule: string
): { scheduled: boolean; nextRun?: Date } {
  console.log("[Orchestrator] scheduleRoutine called - STUB", { routineId, schedule });

  // STUB: Would integrate with a scheduling library
  return {
    scheduled: true,
    nextRun: new Date(Date.now() + 86400000), // Tomorrow
  };
}

// ============================================
// BACKGROUND CHECK (STUB)
// ============================================

/**
 * Trigger a background check across agents
 * @stub Replace with actual background processing
 */
export async function triggerBackgroundCheck(
  checkType: string,
  context?: AgentContext
): Promise<void> {
  console.log("[Orchestrator] triggerBackgroundCheck called - STUB", { checkType });

  // STUB: Would trigger background processing
  const enabledAgents = getEnabledAgents();
  console.log(`[Orchestrator] Would check ${enabledAgents.length} enabled agents`);
}

// ============================================
// EVENT OBSERVATION (STUB)
// ============================================

/**
 * Notify agents of an observed event
 * @stub Replace with actual event broadcasting
 */
export async function broadcastEvent(
  event: { type: string; data: unknown }
): Promise<void> {
  console.log("[Orchestrator] broadcastEvent called - STUB", { eventType: event.type });

  // STUB: Would notify all relevant agents
  const enabledAgents = getEnabledAgents();
  enabledAgents.forEach((agent) => {
    console.log(`[Orchestrator] Would notify agent: ${agent.name}`);
  });
}
