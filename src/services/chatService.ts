/**
 * Chat Service - Agent-Expandable Architecture
 * 
 * This service handles communication with the AI backend.
 * It supports multiple models, agents, and streaming responses.
 */

import { supabase } from "@/integrations/supabase/client";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export interface AgentMetadata {
  agentId?: string;
  intent?: string;
  memory?: Record<string, unknown>;
  activeTools?: string[];
  [key: string]: unknown;
}

/**
 * Model Router - Available models
 */
export const AVAILABLE_MODELS = {
  'gpt-5.4': {
    name: 'GPT-5.4',
    description: 'Latest flagship model - 1M context, best reasoning',
  },
  'gpt-4.1': {
    name: 'GPT-4.1',
    description: 'Flagship GPT-4 model - reliable and powerful',
  },
  'gpt-5': {
    name: 'GPT-5',
    description: 'Previous flagship model - capable',
  },
  'gpt-5-mini': {
    name: 'GPT-5 Mini',
    description: 'Fast and efficient - good balance',
  },
} as const;

export type ModelId = keyof typeof AVAILABLE_MODELS;

/**
 * Agent Registry - Available agents
 */
export const AVAILABLE_AGENTS = {
  base: {
    name: 'Base Assistant',
    description: 'General-purpose assistant',
  },
  money: {
    name: 'Money Agent',
    description: 'Financial analysis and tracking',
  },
  mail: {
    name: 'Mail Agent',
    description: 'Email management and summarization',
  },
  calendar: {
    name: 'Calendar Agent',
    description: 'Schedule and event management',
  },
  analysis: {
    name: 'Analysis Agent',
    description: 'Day reflection and pattern analysis',
  },
} as const;

export type AgentId = keyof typeof AVAILABLE_AGENTS;

export interface UserSettings {
  communicationMode?: 'text' | 'voice' | 'both';
  integrations?: {
    calendar?: boolean;
    email?: boolean;
    banking?: boolean;
  };
  agents?: {
    memory?: boolean;
    orchestration?: boolean;
    communication?: boolean;
    personality?: boolean;
    banking?: boolean;
    summary?: boolean;
  };
  osName?: string;
}

export interface TaskUpdate {
  taskId: string;
  title: string;
  step: string;
  status: 'in_progress' | 'done' | 'error';
  summary?: string;
}

export interface InfinityRouterDebugEvent {
  path: string;
  scores: Record<string, number>;
  classification: Record<string, unknown>;
  enrichment: string | null;
  timing_ms: number;
  fallback: boolean;
}

export interface ProviderUsedEvent {
  model: string;
  source: 'your_key' | 'ozlon';
  platform: string;
  routing_mode?: 'speed' | 'balanced' | 'quality';
  reason?: string;
  latency_ms?: number;
  cost_estimate?: number;
  fallback_used?: boolean;
  fallback_chain?: Array<{ model: string; status: 'failed' | 'succeeded'; error?: string }>;
}

export interface ToolUsedInfo {
  name: string;
  label: string;
}

export interface ToolsUsedEvent {
  tools: ToolUsedInfo[];
}

export interface OrchestrationTraceEvent {
  intent: string | null;
  domains: string[];
  agent_chosen: string;
  wisdom_signal: {
    resonant_sources: Array<{ id: string; person: string; title: string; similarity: number }>;
    dominant_domains: string[];
    framework_hits: string[];
    memory_hits: number;
    reflection_hits: number;
    confidence: number;
  };
  frameworks_injected: Array<{ id: string; title: string }>;
  memories_injected: Array<{ id: string; summary: string }>;
  reflections_injected: Array<{ id: string; type: string }>;
  tools_reordered: boolean;
  router_path: string | null;
}

export interface InvestigationArtifactEvent {
  artifact_id: string;
  message_id: string | null;
  question: string;
}

export interface ResearchArtifactEvent {
  report_id: string;
  message_id: string | null;
  query: string;
  confidence: number;
}

export interface StreamChatOptions {
  messages: Message[];
  intent?: string;
  systemName?: string;
  model?: ModelId;
  agentId?: AgentId;
  agentMetadata?: AgentMetadata;
  enableTools?: boolean;
  userSettings?: UserSettings;
  sessionId?: string;
  assistantMessageId?: string;
  signal?: AbortSignal;
  onDelta: (content: string) => void;
  onToolCall?: (toolName: string, toolArgs: Record<string, unknown>) => void;
  onTaskUpdate?: (update: TaskUpdate) => void;
  onInfinityDebug?: (data: InfinityRouterDebugEvent) => void;
  onProviderUsed?: (data: ProviderUsedEvent) => void;
  onToolsUsed?: (data: ToolsUsedEvent) => void;
  onOrchestrationTrace?: (data: OrchestrationTraceEvent) => void;
  onInvestigationArtifact?: (data: InvestigationArtifactEvent) => void;
  onResearchArtifact?: (data: ResearchArtifactEvent) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

/**
 * Stream chat responses from the AI backend
 * Supports OpenAI-compatible streaming format
 */
export async function streamChat({
  messages,
  intent,
  systemName = 'Ozlon',
  model = 'gpt-5.4',
  agentId,
  agentMetadata,
  enableTools = false,
  userSettings,
  sessionId,
  assistantMessageId,
  signal,
  onDelta,
  onToolCall,
  onTaskUpdate,
  onInfinityDebug,
  onProviderUsed,
  onToolsUsed,
  onOrchestrationTrace,
  onInvestigationArtifact,
  onResearchArtifact,
  onDone,
  onError,
}: StreamChatOptions): Promise<void> {
  try {
    // Resolve auth: ALWAYS need anon key in `apikey`; user JWT (if logged in) goes in Authorization.
    // We FAIL FAST if either is missing/malformed — a bad Bearer string causes the
    // Supabase gateway to reject the request with "invalid JWT" and tools never load.
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!anonKey || typeof anonKey !== 'string' || anonKey.split('.').length !== 3) {
      const msg = 'Missing or malformed VITE_SUPABASE_PUBLISHABLE_KEY — cannot reach chat backend.';
      console.error('[streamChat]', msg);
      onError(msg);
      return;
    }

    let userJwt: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const t = session?.access_token;
      // Real JWTs have exactly three dot-separated segments. Reject anything else.
      if (t && typeof t === 'string' && t.split('.').length === 3) {
        userJwt = t;
      }
    } catch (e) {
      console.warn('[streamChat] getSession failed:', e);
    }

    // Authorization header: prefer user JWT, fall back to anon key (also a valid JWT).
    // NEVER send empty / undefined / malformed.
    const bearer = userJwt || anonKey;
    if (userJwt) {
      console.log('[streamChat] Using authenticated user session.');
    } else {
      console.warn('[streamChat] No user session — running anonymously (no integrations / tools).');
    }

    // Read user's routing budget (Brain page Speed/Balanced/Quality toggle).
    let routingMode: 'speed' | 'balanced' | 'quality' | undefined;
    try {
      const v = localStorage.getItem('ozlon.gauntlet.mode');
      if (v === 'speed' || v === 'balanced' || v === 'quality') routingMode = v;
    } catch { /* ignore */ }

    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
        // apikey is REQUIRED by Supabase gateway; without it the gateway strips Authorization.
        'apikey': anonKey,
      },
      signal,
      body: JSON.stringify({ 
        messages, 
        intent, 
        systemName,
        model,
        agentId,
        agentMetadata,
        enableTools,
        userSettings,
        sessionId,
        assistantMessageId,
        routing_mode: routingMode,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      onError(errorData.error || `HTTP error ${response.status}`);
      return;
    }

    if (!response.body) {
      onError('No response body');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { name: string; arguments: string } | null = null;
    let currentEventType = 'message';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (!trimmedLine || trimmedLine.startsWith(':')) continue;

        // Track SSE event type
        if (trimmedLine.startsWith('event: ')) {
          currentEventType = trimmedLine.slice(7).trim();
          continue;
        }

        if (!trimmedLine.startsWith('data: ')) continue;

        const data = trimmedLine.slice(6);

        if (data === '[DONE]') {
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(data);

          // Handle task_update events
          if (currentEventType === 'task_update' && onTaskUpdate) {
            onTaskUpdate(parsed as TaskUpdate);
            currentEventType = 'message';
            continue;
          }
          // Handle infinity_router_debug events
          if (currentEventType === 'infinity_router_debug' && onInfinityDebug) {
            onInfinityDebug(parsed as InfinityRouterDebugEvent);
            currentEventType = 'message';
            continue;
          }
          // Handle provider_used events (which AI brain answered)
          if (currentEventType === 'provider_used' && onProviderUsed) {
            onProviderUsed(parsed as ProviderUsedEvent);
            currentEventType = 'message';
            continue;
          }
          // Handle tools_used events (which tools the agent invoked)
          if (currentEventType === 'tools_used' && onToolsUsed) {
            onToolsUsed(parsed as ToolsUsedEvent);
            currentEventType = 'message';
            continue;
          }
          // Handle orchestration_trace events (wisdom signal + routing decisions)
          if (currentEventType === 'orchestration_trace' && onOrchestrationTrace) {
            onOrchestrationTrace(parsed as OrchestrationTraceEvent);
            currentEventType = 'message';
            continue;
          }
          // Handle investigation_artifact events (persisted research artifact id)
          if (currentEventType === 'investigation_artifact' && onInvestigationArtifact) {
            onInvestigationArtifact(parsed as InvestigationArtifactEvent);
            currentEventType = 'message';
            continue;
          }
          currentEventType = 'message';

          const choice = parsed.choices?.[0];

          if (!choice) continue;

          // Handle content delta
          const deltaContent = choice.delta?.content;
          if (deltaContent) {
            // Strip hidden uncertainty tags from user-facing text
            const cleaned = deltaContent.replace(/\[uncertain:[^\]]*\]\s*/gi, '');
            if (cleaned) onDelta(cleaned);
          }

          // Handle tool calls (OpenAI format)
          const toolCallDelta = choice.delta?.tool_calls?.[0];
          if (toolCallDelta) {
            if (toolCallDelta.function?.name) {
              currentToolCall = {
                name: toolCallDelta.function.name,
                arguments: toolCallDelta.function.arguments || '',
              };
            } else if (currentToolCall && toolCallDelta.function?.arguments) {
              currentToolCall.arguments += toolCallDelta.function.arguments;
            }
          }

          // Handle finish reason
          if (choice.finish_reason === 'tool_calls' && currentToolCall && onToolCall) {
            try {
              const toolArgs = JSON.parse(currentToolCall.arguments);
              onToolCall(currentToolCall.name, toolArgs);
            } catch {
              console.error('Failed to parse tool arguments');
            }
            currentToolCall = null;
          }

          if (choice.finish_reason === 'stop') {
            onDone();
            return;
          }
        } catch {
          // Only re-buffer if this looks like a split data line
          if (trimmedLine.startsWith('data: ')) {
            buffer = trimmedLine + '\n' + buffer;
          }
          // Continue processing remaining lines instead of breaking
        }
      }
    }

    onDone();
  } catch (error) {
    console.error('Chat stream error:', error);
    onError(error instanceof Error ? error.message : String(error));
  }
}
