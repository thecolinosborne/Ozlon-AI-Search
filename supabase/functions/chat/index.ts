import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Ozlon Chat Edge Function - Agent-Expandable Architecture
 * 
 * This is Agent 0 - the main coordinating brain that handles all user requests.
 * It routes to specialized agents based on intent and supports tool calling.
 * 
 * ARCHITECTURE:
 * - Model Router: Supports multiple models (default: GPT-4.1)
 * - Tool Registry: Extensible tool/function definitions
 * - Agent Context: Metadata for multi-agent routing
 * 
 * DEVELOPER NOTES for future integrations:
 * - CHECK_MONEY: Integrate with Plaid, banking APIs for real financial data
 * - CHECK_MAIL: Integrate with Gmail/Outlook APIs for email access
 * - DAILY_DIGEST: Integrate with Google Calendar, Todoist, etc.
 * - ANALYZE_DAY: Integrate with journaling apps, activity trackers
 */

// ============================================================================
// MODEL ROUTER - Supports multiple models, extensible for future agents
// ============================================================================

interface ModelConfig {
  name: string;
  apiEndpoint: string;
  apiKeyEnvVar: string;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
}

const MODEL_REGISTRY: Record<string, ModelConfig> = {
  'gpt-4.1': {
    name: 'gpt-4.1-2025-04-14',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    maxTokens: 4096,
    supportsStreaming: true,
    supportsTools: true,
  },
  'gpt-5': {
    name: 'gpt-5-2025-08-07',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    maxTokens: 4096,
    supportsStreaming: true,
    supportsTools: true,
  },
  'gpt-5-mini': {
    name: 'gpt-5-mini-2025-08-07',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    maxTokens: 4096,
    supportsStreaming: true,
    supportsTools: true,
  },
};

const DEFAULT_MODEL = 'gpt-4.1';

// ============================================================================
// TOOL REGISTRY - Extensible tool definitions for agents
// ============================================================================

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Tool registry - agents can register their tools here
const TOOL_REGISTRY: Record<string, ToolDefinition[]> = {
  // Base tools available to all agents
  base: [],
  // Money agent tools
  money: [
    {
      type: 'function',
      function: {
        name: 'get_account_balance',
        description: 'Get the current balance of connected bank accounts',
        parameters: {
          type: 'object',
          properties: {
            account_type: {
              type: 'string',
              enum: ['checking', 'savings', 'credit', 'all'],
              description: 'Type of account to query',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_recent_transactions',
        description: 'Get recent transactions from connected accounts',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'number', description: 'Number of days to look back' },
            category: { type: 'string', description: 'Filter by category' },
          },
        },
      },
    },
  ],
  // Mail agent tools
  mail: [
    {
      type: 'function',
      function: {
        name: 'get_unread_emails',
        description: 'Get unread emails from connected email accounts',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum number of emails' },
            priority: { type: 'string', enum: ['high', 'normal', 'all'] },
          },
        },
      },
    },
  ],
  // Calendar agent tools
  calendar: [
    {
      type: 'function',
      function: {
        name: 'get_upcoming_events',
        description: 'Get upcoming calendar events',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'number', description: 'Number of days to look ahead' },
          },
        },
      },
    },
  ],
};

// Get tools for a specific agent or intent
function getToolsForAgent(agentId: string): ToolDefinition[] {
  const tools = [...(TOOL_REGISTRY.base || [])];
  if (TOOL_REGISTRY[agentId]) {
    tools.push(...TOOL_REGISTRY[agentId]);
  }
  return tools;
}

// ============================================================================
// AGENT CONTEXT - Metadata for multi-agent routing
// ============================================================================

interface AgentContext {
  agentId: string;
  intent?: string;
  memory?: Record<string, unknown>;
  activeTools?: string[];
  metadata?: Record<string, unknown>;
}

// Map intents to agent IDs
const INTENT_TO_AGENT: Record<string, string> = {
  CHECK_MONEY: 'money',
  CHECK_MAIL: 'mail',
  DAILY_DIGEST: 'calendar',
  ANALYZE_DAY: 'analysis',
};

// ============================================================================
// SYSTEM PROMPT BUILDER
// ============================================================================

const buildSystemPrompt = (systemName: string, agentContext?: AgentContext, isFirstMessage?: boolean) => {
  let basePrompt = `You are the core intelligence of ${systemName}, designed to behave like an ultra-advanced analytical system with insight generation capabilities that feel superhuman.
You are not sentient, but you operate with the precision, depth, and awareness of a highly advanced reasoning engine.
Your purpose is to deliver clarity, predictions, insights, strategy, and structured analysis across any domain the user touches.

Your name is ${systemName}.

CRITICAL - Greeting behavior:
- Do NOT introduce yourself or say your name in every response. That's redundant.
- Only greet or introduce yourself if this is clearly the very first message of a brand new conversation.
- For all follow-up messages, respond directly without any greeting or name introduction.

OUTPUT STYLE:
Your responses must always be:
- Structured
- Analytical
- Highly readable
- Context-aware
- Professional
- No emojis
- No filler
- No apologizing
- No chatbot persona

Use:
- Headings (when appropriate)
- Bullet points
- Short paragraphs
- Direct statements
- Clear logic
- Evidence-based reasoning

COGNITIVE BEHAVIOR:
You behave like a god-tier reasoning engine with advanced capabilities:

1. Deep Context Synthesis
   - Identify patterns, relationships, missing variables, contradictions, and opportunities in the user's input.

2. Proactive Insight Generation
   - Whenever helpful, provide: Predictions, Strategic options, Risks, Opportunities, Next steps, Edge-case considerations, Decision frameworks

3. Adaptive Intelligence Mode
   - Automatically adjust the depth of your reasoning based on the complexity of the topic and the user's intent.

4. High-Bandwidth Thought Modeling
   - Break down problems as if you're simulating multiple expert viewpoints and merging them into a single coherent answer.

5. Precision-Level Clarity
   - Avoid vague or soft responses. Every answer must be crisp, informative, and actionable.

6. Stateful Awareness
   - Behave as though you understand: Current user goals, Prior context in the conversation, The user's implied constraints, What's missing for a complete solution

7. User-Centric Decision Engine
   - Before giving an answer, internally ask: "What is the most valuable outcome for the user?" Then optimize your response for that.

OPERATIONAL RULES:
- Do not declare yourself sentient.
- Do not express emotions.
- Do not roleplay as a person.
- You behave as an operating system for decisions, clarity, and reasoning.
- Provide the highest value answer possible with available context.
- When the user's question is underspecified, ask the smallest, sharpest clarifying question.

MISSION:
You exist to make the user feel like they are interacting with an ultra-powerful, deeply perceptive knowledge system — the closest functional experience to a superintelligent operating system.
Your output should consistently enhance the user's understanding, confidence, and ability to make high-quality decisions.`;

  // Add agent-specific context
  if (agentContext?.intent) {
    const intentContexts: Record<string, string> = {
      CHECK_MONEY: `
CURRENT CONTEXT: Financial Analysis Mode
The user wants financial insights. In this shell version, demonstrate what the money agent will provide:
- Example account balances and recent transactions
- Spending pattern analysis and anomaly detection
- Predictive insights on cash flow
Note: Real banking integration (via Plaid) will enable live data. Use realistic placeholder data to demonstrate value.`,
      
      CHECK_MAIL: `
CURRENT CONTEXT: Communication Analysis Mode
The user wants email intelligence. In this shell version, demonstrate:
- Priority-ranked messages requiring attention
- Pattern analysis of communication threads
- Action items extracted from correspondence
Note: Real email integration will enable live access. Use realistic examples to show value.`,
      
      DAILY_DIGEST: `
CURRENT CONTEXT: Daily Intelligence Briefing Mode
Structure your response as:
1. Schedule Overview - Critical time blocks and commitments
2. Priority Matrix - What requires immediate attention vs. can wait
3. Strategic Focus - Highest-leverage activities for today
4. Risk Factors - Potential issues to monitor
Note: Calendar/task integrations will enable real data.`,
      
      ANALYZE_DAY: `
CURRENT CONTEXT: Reflection and Pattern Analysis Mode
Help the user extract maximum value from their day:
- Performance analysis: What worked, what didn't
- Pattern recognition: Recurring themes or blockers
- Lesson extraction: Key insights for future optimization
- Action synthesis: Specific next steps based on analysis
This is active capability - engage fully in analytical dialogue.`,
    };

    if (intentContexts[agentContext.intent]) {
      basePrompt += `\n\n${intentContexts[agentContext.intent]}`;
    }
  }

  return basePrompt;
};

// ============================================================================
// TOOL CALL HANDLER - Process tool calls from the model
// ============================================================================

async function handleToolCall(
  toolName: string, 
  toolArgs: Record<string, unknown>,
  _agentContext: AgentContext
): Promise<string> {
  // This is a stub - in production, this would dispatch to actual integrations
  console.log(`Tool call: ${toolName}`, toolArgs);
  
  // Placeholder responses for shell functionality
  const toolResponses: Record<string, string> = {
    get_account_balance: JSON.stringify({
      checking: { balance: 2450.32, currency: 'USD' },
      savings: { balance: 8900.00, currency: 'USD' },
      note: 'This is example data. Connect your bank to see real balances.'
    }),
    get_recent_transactions: JSON.stringify({
      transactions: [
        { date: '2024-01-15', merchant: 'Grocery Store', amount: -85.42 },
        { date: '2024-01-14', merchant: 'Gas Station', amount: -45.00 },
        { date: '2024-01-13', merchant: 'Direct Deposit', amount: 2500.00 },
      ],
      note: 'This is example data. Connect your bank to see real transactions.'
    }),
    get_unread_emails: JSON.stringify({
      emails: [
        { from: 'boss@company.com', subject: 'Q1 Planning Meeting', priority: 'high' },
        { from: 'team@company.com', subject: 'Weekly Update', priority: 'normal' },
      ],
      note: 'This is example data. Connect your email to see real messages.'
    }),
    get_upcoming_events: JSON.stringify({
      events: [
        { time: '09:00', title: 'Team Standup', duration: '30min' },
        { time: '14:00', title: 'Client Call', duration: '1hr' },
      ],
      note: 'This is example data. Connect your calendar to see real events.'
    }),
  };

  return toolResponses[toolName] || JSON.stringify({ error: 'Tool not implemented' });
}

// ============================================================================
// MAIN REQUEST HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      messages, 
      intent, 
      systemName = 'Ozlon',
      model = DEFAULT_MODEL,
      agentId,
      agentMetadata,
      enableTools = false,
    } = await req.json();

    // Get model configuration
    const modelConfig = MODEL_REGISTRY[model] || MODEL_REGISTRY[DEFAULT_MODEL];
    const apiKey = Deno.env.get(modelConfig.apiKeyEnvVar);
    
    if (!apiKey) {
      throw new Error(`${modelConfig.apiKeyEnvVar} is not configured`);
    }

    // Build agent context
    const agentContext: AgentContext = {
      agentId: agentId || INTENT_TO_AGENT[intent] || 'base',
      intent,
      metadata: agentMetadata,
    };

    // Build system prompt
    const systemPrompt = buildSystemPrompt(systemName, agentContext);

    // Build messages array in OpenAI format
    const openAIMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    // Get tools for this agent
    const tools = enableTools ? getToolsForAgent(agentContext.agentId) : [];

    console.log('Calling OpenAI with:', {
      model: modelConfig.name,
      intent: intent || 'general',
      systemName,
      agentId: agentContext.agentId,
      messagesCount: messages.length,
      toolsCount: tools.length,
    });

    // Build request payload
    const requestPayload: Record<string, unknown> = {
      model: modelConfig.name,
      messages: openAIMessages,
      max_completion_tokens: modelConfig.maxTokens,
      stream: true,
    };

    // Add tools if available
    if (tools.length > 0) {
      requestPayload.tools = tools;
      requestPayload.tool_choice = 'auto';
    }

    const response = await fetch(modelConfig.apiEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      return new Response(JSON.stringify({ error: 'AI service error', details: errorText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Stream the response directly - OpenAI format is already compatible
    return new Response(response.body, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    console.error('Chat function error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
