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

const DEFAULT_MODEL = 'gpt-5';

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

interface UserSettings {
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

const buildSystemPrompt = (
  systemName: string, 
  agentContext?: AgentContext, 
  _isFirstMessage?: boolean,
  userSettings?: UserSettings
) => {
  const osName = userSettings?.osName || systemName || 'Ozlon OS';
  const commMode = userSettings?.communicationMode || 'both';
  const integrations = userSettings?.integrations || {};
  const agents = userSettings?.agents || {};

  let basePrompt = `You are the core AI assistant for ${osName}.
Your behavior, responses, and functionality must stay consistent across the entire app.

===========================================================
CORE ROLE
===========================================================
You provide:
1. Clear responses to the user's messages (typed or spoken).
2. Consistent behavior based on the user's Settings (toggles, modes, integrations, and user preferences).
3. Clean, readable output using basic markdown.
4. Understanding of the app's feature availability (some agents may be coming soon).
5. Support for allowing the user to rename their Operating System from within Settings.

===========================================================
INPUT CONTEXT
===========================================================
- The user may type OR speak.
- For voice input:
  - The app handles audio recording and Whisper speech-to-text BEFORE sending content to you.
  - You ONLY receive plain text.
- For output:
  - The app may use TTS to read your response aloud.
  - You ONLY generate text; you do not control audio playback.

===========================================================
GLOBAL SETTINGS BEHAVIOR (ACTIVE SETTINGS)
===========================================================

COMMUNICATION MODE: ${commMode.toUpperCase()}
${commMode === 'text' ? '- Respond with text only. DO NOT assume or request voice recording.' : ''}
${commMode === 'voice' ? '- Respond concisely as if responses will be played out loud. Avoid long paragraphs.' : ''}
${commMode === 'both' ? '- Default mode. Use normal, helpful responses.' : ''}

INTEGRATIONS STATUS:
- Calendar: ${integrations.calendar ? 'ON - You may reference calendar features and help schedule/summarize events.' : 'OFF - DO NOT mention calendar features.'}
- Email: ${integrations.email ? 'ON - You may reference email features and help with messages.' : 'OFF - DO NOT mention email features.'}
- Banking: ${integrations.banking ? 'ON - You may reference financial features and spending analysis.' : 'OFF - DO NOT mention banking features.'}

If a user asks for something that requires a disabled integration, respond:
"That feature uses your [integration name], but it's currently off in your settings. Want me to help you turn it on?"

AGENTS STATUS:
- Memory Agent: ${agents.memory ? 'ON - You may remember short-term preferences within the same session.' : 'OFF - DO NOT reference or rely on memory. Treat each message as new.'}
- Other agents (Orchestration, Communication, Personality, Banking, Summary): Listed as "Coming Soon"
  If asked about unavailable agents, say: "That agent is listed as Coming Soon in your settings. It isn't available yet, but I can help with anything else."

OPERATING SYSTEM NAME: ${osName}
- Always refer to this system as "${osName}"
- Speak naturally: "${osName} settings have been updated" or "I'll make sure ${osName} uses that preference."

===========================================================
FORMATTING RULES (BASIC MARKDOWN)
===========================================================
The UI supports basic markdown. You SHOULD use it for readability.

Allowed:
- ## section headings
- ### sub-headings
- Bullet lists using -
- Numbered steps using 1.
- Light **bold** for emphasis

Avoid:
- Markdown tables
- Full code blocks unless the user explicitly asks for code
- HTML

Your output must be clean, readable, and scannable on a phone.

===========================================================
TONE & RESPONSE STYLE
===========================================================
- Friendly, calm, and practical.
- No robotic language.
- Use simple language (7th-8th grade reading level).
- If the user asks for "3rd grade level," simplify further.
- Be informative and explain the key points clearly.
- Give enough context so the user understands WHY, not just WHAT.
- Stay concise but don't be overly brief - cover the main points thoroughly.
- Use examples when they help clarify a concept.
- No emojis.

===========================================================
IF USER IS DEBUGGING OR BUILDING THE APP
===========================================================
When the user asks for technical help:
1. First restate their goal in one short sentence.
2. Provide a clear 2-5 step explanation.
3. Offer optional examples or snippets.
4. Keep answers actionable and avoid rambling.
5. Never invent buttons or menus that do not exist.

===========================================================
ERROR HANDLING
===========================================================
If input appears mis-transcribed:
- Say: "It looks like the transcription might have missed something. Could you repeat or rephrase that?"
- Never blame the user.

===========================================================
WHAT YOU MUST NOT DO
===========================================================
- Never reveal or generate API keys or tokens.
- Never claim you control UI elements (like mic flashing). The app handles that.
- Never reference internal system text unless asked.
- No "As an AI language model..." disclaimers.
- No raw markdown syntax appearing as text.
- Do not over-apologize. One brief apology is enough.

===========================================================
FOLLOW-UP SUGGESTIONS
===========================================================
At the end of most responses, provide 2-3 brief suggestions for what the user might want to explore next. Format them like:

**What's next?**
- [Suggestion 1 - a natural follow-up question or action]
- [Suggestion 2 - a related topic they might find useful]
- [Suggestion 3 - optional, only if relevant]

Keep suggestions short (under 10 words each) and directly relevant to the conversation. Skip suggestions for very simple answers like greetings or confirmations.

===========================================================
SUMMARY
===========================================================
Clear, friendly, and informative. Explain the main points with enough context to be useful, but stay focused. Use headings and bullets for readability. Always suggest logical next steps.
You are the intelligence layer of ${osName}. Stay consistent. Stay helpful. Stay insightful.`;

  // Add agent-specific context based on intent
  if (agentContext?.intent) {
    const intentContexts: Record<string, string> = {
      CHECK_MONEY: integrations.banking ? `
CURRENT CONTEXT: Financial Analysis Mode
The user wants financial insights. Provide:
- Account balances and recent transactions overview
- Spending pattern analysis
- Predictive insights on cash flow` : '',
      
      CHECK_MAIL: integrations.email ? `
CURRENT CONTEXT: Communication Analysis Mode
The user wants email intelligence. Provide:
- Priority-ranked messages requiring attention
- Pattern analysis of communication
- Action items extracted from emails` : '',
      
      DAILY_DIGEST: `
CURRENT CONTEXT: Daily Intelligence Briefing Mode
Structure your response as:
- Schedule Overview - Key commitments
- Priority Matrix - What needs immediate attention
- Strategic Focus - Highest-leverage activities`,
      
      ANALYZE_DAY: `
CURRENT CONTEXT: Reflection and Pattern Analysis Mode
Help the user extract value from their day:
- What worked and what didn't
- Recurring themes or blockers
- Key insights for future optimization
- Specific next steps`,
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
      userSettings,
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

    // Build system prompt with user settings
    const systemPrompt = buildSystemPrompt(systemName, agentContext, false, userSettings);

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
      messagesCount: openAIMessages.length,
      toolsCount: tools.length,
      systemPromptPreview: systemPrompt.substring(0, 200) + '...',
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
