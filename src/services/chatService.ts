/**
 * Chat Service - Agent-Expandable Architecture
 * 
 * This service handles communication with the AI backend.
 * It supports multiple models, agents, and streaming responses.
 */

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
  'gpt-4.1': {
    name: 'GPT-4.1',
    description: 'Flagship GPT-4 model - reliable and powerful',
  },
  'gpt-5': {
    name: 'GPT-5',
    description: 'Latest flagship model - most capable',
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
  onDelta: (content: string) => void;
  onToolCall?: (toolName: string, toolArgs: Record<string, unknown>) => void;
  onTaskUpdate?: (update: TaskUpdate) => void;
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
  model = 'gpt-4.1',
  agentId,
  agentMetadata,
  enableTools = false,
  userSettings,
  onDelta,
  onToolCall,
  onTaskUpdate,
  onDone,
  onError,
}: StreamChatOptions): Promise<void> {
  try {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ 
        messages, 
        intent, 
        systemName,
        model,
        agentId,
        agentMetadata,
        enableTools,
        userSettings,
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
          const choice = parsed.choices?.[0];

          if (!choice) continue;

          // Handle content delta
          const deltaContent = choice.delta?.content;
          if (deltaContent) {
            onDelta(deltaContent);
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
          // Re-buffer incomplete JSON
          buffer = line + '\n' + buffer;
          break;
        }
      }
    }

    onDone();
  } catch (error) {
    console.error('Chat stream error:', error);
    onError(error instanceof Error ? error.message : String(error));
  }
}
