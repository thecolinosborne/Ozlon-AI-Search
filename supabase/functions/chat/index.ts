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
At the end of most responses, offer 2-3 contextual suggestions - things YOU can do for the user as a logical next step. Think of it like a decision tree branching from the current topic.

Format them as actionable offers:

**Want me to:**
- [Action you can take based on what was just discussed]
- [Related task that naturally follows]
- [Deeper dive or alternative approach - optional]

Examples based on context:
- If discussing finances: "Break down your top 3 spending categories?" or "Set up a savings goal?"
- If discussing schedule: "Block focus time for tomorrow?" or "Find conflicts this week?"
- If explaining a concept: "Walk through an example?" or "Compare it to alternatives?"

Make suggestions specific to THEIR situation, not generic. Each suggestion should feel like a natural branch the conversation could take. Skip suggestions for simple greetings or yes/no confirmations.

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
// MATON GATEWAY - Multi-service real data engine
// ============================================================================

const MATON_CTRL_URL = 'https://ctrl.maton.ai';
const MATON_GATEWAY_URL = 'https://gateway.maton.ai';

interface MatonConnection {
  app: string;
  connection_id: string;
  status: string;
  metadata?: Record<string, unknown>;
}

async function getMatonConnections(matonApiKey: string): Promise<MatonConnection[]> {
  try {
    const res = await fetch(`${MATON_CTRL_URL}/connections`, {
      headers: { 'Authorization': `Bearer ${matonApiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.connections || []).filter((c: MatonConnection) => c.status === 'ACTIVE');
  } catch { return []; }
}

async function callMatonGateway(
  matonApiKey: string, path: string, connectionId: string, method = 'GET', body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${MATON_GATEWAY_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${matonApiKey}`,
      'Content-Type': 'application/json',
      'Maton-Connection': connectionId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return { raw: await res.text() };
}

// ============================================================================
// SERVICE INTENT DETECTION - Maps user messages to Maton app IDs
// ============================================================================

interface ServiceDetection {
  app: string;       // Maton app ID
  label: string;     // Human-readable label
  keywords: string[];
}

const SERVICE_DETECTORS: ServiceDetection[] = [
  { app: 'google-search-console', label: 'Google Search Console', keywords: ['search console', 'gsc', 'seo', 'search performance', 'impressions', 'clicks', 'search queries', 'keyword', 'ranking', 'serp', 'search traffic', 'ctr', 'click-through', 'search analytics', 'organic search', 'web traffic'] },
  { app: 'google-mail', label: 'Gmail', keywords: ['email', 'emails', 'gmail', 'mail', 'inbox', 'unread', 'messages', 'send email', 'draft', 'newsletter'] },
  { app: 'google-calendar', label: 'Google Calendar', keywords: ['calendar', 'schedule', 'meeting', 'meetings', 'event', 'events', 'appointment', 'appointments', 'busy', 'free time', 'availability', 'agenda', 'tomorrow', 'this week', 'next week'] },
  { app: 'google-drive', label: 'Google Drive', keywords: ['drive', 'google drive', 'files', 'documents', 'docs', 'sheets', 'slides', 'spreadsheet', 'folder', 'shared drive'] },
  { app: 'google-ads', label: 'Google Ads', keywords: ['google ads', 'adwords', 'ad campaign', 'ad spend', 'ppc', 'cost per click', 'ad performance', 'campaigns', 'ad groups'] },
  { app: 'google-analytics', label: 'Google Analytics', keywords: ['analytics', 'google analytics', 'ga4', 'page views', 'sessions', 'bounce rate', 'visitors', 'website traffic', 'site traffic', 'user behavior'] },
  { app: 'slack', label: 'Slack', keywords: ['slack', 'slack message', 'channel', 'channels', 'dm', 'direct message', 'workspace'] },
  { app: 'notion', label: 'Notion', keywords: ['notion', 'notion page', 'notion database', 'wiki', 'notes'] },
  { app: 'airtable', label: 'Airtable', keywords: ['airtable', 'base', 'airtable base', 'airtable table'] },
  { app: 'hubspot', label: 'HubSpot', keywords: ['hubspot', 'crm', 'contacts', 'deals', 'pipeline', 'leads', 'sales pipeline'] },
  { app: 'quickbooks-online', label: 'QuickBooks', keywords: ['quickbooks', 'accounting', 'invoices', 'expenses', 'profit', 'loss', 'revenue', 'bookkeeping', 'p&l', 'balance sheet'] },
  { app: 'stripe', label: 'Stripe', keywords: ['stripe', 'payments', 'charges', 'subscriptions', 'mrr', 'revenue', 'customers', 'payment'] },
  { app: 'shopify', label: 'Shopify', keywords: ['shopify', 'store', 'orders', 'products', 'inventory', 'ecommerce', 'e-commerce', 'sales'] },
  { app: 'trello', label: 'Trello', keywords: ['trello', 'trello board', 'cards', 'trello cards'] },
  { app: 'asana', label: 'Asana', keywords: ['asana', 'asana task', 'asana project'] },
  { app: 'clickup', label: 'ClickUp', keywords: ['clickup', 'clickup task'] },
  { app: 'jira', label: 'Jira', keywords: ['jira', 'jira ticket', 'jira issue', 'sprint', 'backlog'] },
  { app: 'github', label: 'GitHub', keywords: ['github', 'pull request', 'pr', 'commit', 'commits', 'repository', 'repo', 'issues', 'merge'] },
  { app: 'microsoft-teams', label: 'Microsoft Teams', keywords: ['teams', 'microsoft teams', 'ms teams'] },
  { app: 'zoom', label: 'Zoom', keywords: ['zoom', 'zoom meeting', 'zoom call', 'video call'] },
  { app: 'discord', label: 'Discord', keywords: ['discord', 'discord server', 'discord channel'] },
  { app: 'typeform', label: 'Typeform', keywords: ['typeform', 'form responses', 'survey', 'survey responses'] },
];

function detectServiceIntents(messages: { role: string; content: string }[]): string[] {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) return [];
  const lower = lastUserMsg.content.toLowerCase();
  const detected: string[] = [];
  for (const svc of SERVICE_DETECTORS) {
    if (svc.keywords.some(k => lower.includes(k))) {
      detected.push(svc.app);
    }
  }
  return detected;
}

// ============================================================================
// SERVICE DATA FETCHERS - One per Maton app
// ============================================================================

function getYesterdayAndDayBefore(): [string, string] {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const db = new Date(); db.setDate(db.getDate() - 2);
  return [y.toISOString().split('T')[0], db.toISOString().split('T')[0]];
}

async function fetchGSCData(key: string, connId: string): Promise<string> {
  const sitesData = await callMatonGateway(key, '/google-search-console/webmasters/v3/sites', connId) as { siteEntry?: { siteUrl: string }[] };
  const sites = sitesData.siteEntry || [];
  if (!sites.length) return 'No sites found in GSC.';
  const [dateStr, dayBeforeStr] = getYesterdayAndDayBefore();
  const reports: string[] = [];
  for (const site of sites) {
    try {
      const [yd, dbd] = await Promise.all([
        callMatonGateway(key, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`, connId, 'POST', { startDate: dateStr, endDate: dateStr, dimensions: ['query'], rowLimit: 20 }),
        callMatonGateway(key, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`, connId, 'POST', { startDate: dayBeforeStr, endDate: dayBeforeStr, dimensions: ['query'], rowLimit: 20 }),
      ]) as [{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }, { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }];
      const yRows = yd.rows || []; const dbRows = dbd.rows || [];
      const yT = yRows.reduce((a, r) => ({ c: a.c + r.clicks, i: a.i + r.impressions }), { c: 0, i: 0 });
      const dbT = dbRows.reduce((a, r) => ({ c: a.c + r.clicks, i: a.i + r.impressions }), { c: 0, i: 0 });
      let r = `### ${site.siteUrl}\nYesterday (${dateStr}): ${yT.c} clicks, ${yT.i} impressions | Day before: ${dbT.c} clicks, ${dbT.i} impressions\n`;
      if (yRows.length) { r += 'Top queries:\n'; for (const row of yRows.slice(0, 10)) r += `- "${row.keys[0]}": ${row.clicks} clicks, ${row.impressions} imp, pos ${row.position.toFixed(1)}, CTR ${(row.ctr*100).toFixed(1)}%\n`; }
      else r += 'No query data for yesterday (GSC data may be delayed 2-3 days).\n';
      reports.push(r);
    } catch (e) { reports.push(`### ${site.siteUrl}\nError: ${e instanceof Error ? e.message : 'Unknown'}\n`); }
  }
  return reports.join('\n');
}

async function fetchGmailData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/google-mail/gmail/v1/users/me/messages?maxResults=15&q=is:unread', connId) as { messages?: { id: string }[]; resultSizeEstimate?: number };
  const msgs = data.messages || [];
  if (!msgs.length) return 'No unread emails.';
  const details: string[] = [`Unread count: ~${data.resultSizeEstimate || msgs.length}`];
  const toFetch = msgs.slice(0, 8);
  for (const m of toFetch) {
    try {
      const full = await callMatonGateway(key, `/google-mail/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, connId) as { payload?: { headers?: { name: string; value: string }[] }; snippet?: string };
      const headers = full.payload?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const date = headers.find(h => h.name === 'Date')?.value || '';
      details.push(`- From: ${from} | Subject: ${subject} | ${date}\n  Preview: ${(full.snippet || '').substring(0, 120)}`);
    } catch { details.push(`- Message ${m.id}: could not load details`); }
  }
  return details.join('\n');
}

async function fetchCalendarData(key: string, connId: string): Promise<string> {
  const now = new Date();
  const endOfWeek = new Date(); endOfWeek.setDate(endOfWeek.getDate() + 7);
  const data = await callMatonGateway(key, `/google-calendar/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${endOfWeek.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`, connId) as { items?: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }[] };
  const events = data.items || [];
  if (!events.length) return 'No upcoming events in the next 7 days.';
  return events.map(e => {
    const start = e.start?.dateTime || e.start?.date || 'TBD';
    const end = e.end?.dateTime || e.end?.date || '';
    return `- ${e.summary || '(no title)'} | ${start}${end ? ' to ' + end : ''}${e.location ? ' | ' + e.location : ''}`;
  }).join('\n');
}

async function fetchGoogleDriveData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/google-drive/drive/v3/files?pageSize=15&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)', connId) as { files?: { name: string; mimeType: string; modifiedTime: string; webViewLink?: string }[] };
  const files = data.files || [];
  if (!files.length) return 'No recent files found.';
  return files.map(f => `- ${f.name} (${f.mimeType?.split('.').pop() || 'file'}) - modified ${f.modifiedTime}`).join('\n');
}

async function fetchGoogleAdsData(key: string, connId: string): Promise<string> {
  try {
    const data = await callMatonGateway(key, '/google-ads/v17/customers:listAccessibleCustomers', connId) as { resourceNames?: string[] };
    const customers = data.resourceNames || [];
    return `Accessible Google Ads accounts: ${customers.length}\n${customers.map(c => `- ${c}`).join('\n')}`;
  } catch { return 'Could not fetch Google Ads data. The API may require additional configuration.'; }
}

async function fetchGoogleAnalyticsData(key: string, connId: string): Promise<string> {
  try {
    const data = await callMatonGateway(key, '/google-analytics/analytics/data/v1beta/properties:runReport', connId, 'POST', {}) as Record<string, unknown>;
    return `Google Analytics data:\n${JSON.stringify(data, null, 2).substring(0, 2000)}`;
  } catch { return 'Could not fetch Google Analytics data. Try asking about a specific property.'; }
}

async function fetchSlackData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/slack/api/conversations.list?types=public_channel,private_channel&limit=10', connId) as { channels?: { name: string; num_members?: number; purpose?: { value?: string } }[] };
  const channels = data.channels || [];
  const unread = await callMatonGateway(key, '/slack/api/conversations.list?types=im&limit=5', connId) as { channels?: { user?: string }[] };
  const dms = unread.channels || [];
  return `Channels (${channels.length}):\n${channels.map(c => `- #${c.name} (${c.num_members || '?'} members)`).join('\n')}\n\nDirect messages: ${dms.length} recent conversations`;
}

async function fetchHubSpotData(key: string, connId: string): Promise<string> {
  const [contacts, deals] = await Promise.all([
    callMatonGateway(key, '/hubspot/crm/v3/objects/contacts?limit=10&properties=firstname,lastname,email,createdate', connId) as Promise<{ results?: { properties?: Record<string, string> }[] }>,
    callMatonGateway(key, '/hubspot/crm/v3/objects/deals?limit=10&properties=dealname,amount,dealstage,createdate', connId) as Promise<{ results?: { properties?: Record<string, string> }[] }>,
  ]);
  const c = (contacts.results || []).map(r => `- ${r.properties?.firstname || ''} ${r.properties?.lastname || ''} (${r.properties?.email || 'no email'})`).join('\n');
  const d = (deals.results || []).map(r => `- ${r.properties?.dealname || 'Untitled'}: $${r.properties?.amount || '0'} (${r.properties?.dealstage || 'unknown'})`).join('\n');
  return `Recent Contacts:\n${c || 'None'}\n\nRecent Deals:\n${d || 'None'}`;
}

async function fetchStripeData(key: string, connId: string): Promise<string> {
  const [charges, balance] = await Promise.all([
    callMatonGateway(key, '/stripe/v1/charges?limit=10', connId) as Promise<{ data?: { amount: number; currency: string; status: string; created: number; description?: string }[] }>,
    callMatonGateway(key, '/stripe/v1/balance', connId) as Promise<{ available?: { amount: number; currency: string }[]; pending?: { amount: number; currency: string }[] }>,
  ]);
  const bal = (balance.available || []).map(b => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ');
  const pend = (balance.pending || []).map(b => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ');
  const recent = (charges.data || []).map(c => `- $${(c.amount / 100).toFixed(2)} ${c.currency.toUpperCase()} - ${c.status} - ${c.description || 'no desc'} (${new Date(c.created * 1000).toLocaleDateString()})`).join('\n');
  return `Balance: ${bal || 'N/A'} available, ${pend || 'N/A'} pending\n\nRecent charges:\n${recent || 'None'}`;
}

async function fetchShopifyData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/shopify/admin/api/2024-01/orders.json?status=any&limit=10', connId) as { orders?: { name: string; total_price: string; created_at: string; financial_status: string }[] };
  const orders = data.orders || [];
  if (!orders.length) return 'No recent orders.';
  return orders.map(o => `- ${o.name}: $${o.total_price} (${o.financial_status}) - ${new Date(o.created_at).toLocaleDateString()}`).join('\n');
}

async function fetchNotionData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/notion/v1/search', connId, 'POST', { page_size: 10, sort: { direction: 'descending', timestamp: 'last_edited_time' } }) as { results?: { object: string; id: string; properties?: Record<string, unknown>; url?: string; last_edited_time?: string; parent?: unknown }[] };
  const results = data.results || [];
  if (!results.length) return 'No recent Notion pages found.';
  return results.map(r => {
    const titleProp = r.properties ? Object.values(r.properties).find((p: unknown) => (p as Record<string, unknown>)?.type === 'title') as { title?: { plain_text?: string }[] } | undefined : undefined;
    const title = titleProp?.title?.[0]?.plain_text || '(untitled)';
    return `- ${r.object}: ${title} (edited ${r.last_edited_time || 'unknown'})`;
  }).join('\n');
}

async function fetchGitHubData(key: string, connId: string): Promise<string> {
  const [notifications, repos] = await Promise.all([
    callMatonGateway(key, '/github/notifications?per_page=10', connId) as Promise<{ id?: string; reason?: string; subject?: { title?: string; type?: string } }[]>,
    callMatonGateway(key, '/github/user/repos?sort=updated&per_page=5', connId) as Promise<{ name: string; full_name: string; updated_at: string; open_issues_count?: number }[]>,
  ]);
  const notifs = Array.isArray(notifications) ? notifications.map((n: { subject?: { title?: string; type?: string }; reason?: string }) => `- ${n.subject?.type || '?'}: ${n.subject?.title || '?'} (${n.reason})`).join('\n') : 'No notifications';
  const repoList = Array.isArray(repos) ? repos.map((r: { full_name: string; updated_at: string; open_issues_count?: number }) => `- ${r.full_name} (updated ${r.updated_at}, ${r.open_issues_count || 0} issues)`).join('\n') : 'No repos';
  return `Notifications:\n${notifs}\n\nRecent repos:\n${repoList}`;
}

async function fetchGenericProjectData(key: string, connId: string, app: string): Promise<string> {
  // For Trello, Asana, ClickUp, Jira - try common task/project endpoints
  const endpoints: Record<string, string> = {
    'trello': '/trello/1/members/me/boards?fields=name,dateLastActivity',
    'asana': '/asana/api/1.0/users/me/user_task_list',
    'clickup': '/clickup/api/v2/team',
    'jira': '/jira/rest/api/3/myself',
  };
  if (!endpoints[app]) return `${app} is connected but no specific fetcher is configured yet.`;
  try {
    const data = await callMatonGateway(key, endpoints[app], connId);
    return JSON.stringify(data, null, 2).substring(0, 2000);
  } catch (e) { return `Could not fetch ${app} data: ${e instanceof Error ? e.message : 'Unknown'}`; }
}

// Service fetcher registry
const SERVICE_FETCHERS: Record<string, (key: string, connId: string) => Promise<string>> = {
  'google-search-console': fetchGSCData,
  'google-mail': fetchGmailData,
  'google-calendar': fetchCalendarData,
  'google-drive': fetchGoogleDriveData,
  'google-ads': fetchGoogleAdsData,
  'google-analytics': fetchGoogleAnalyticsData,
  'slack': fetchSlackData,
  'hubspot': fetchHubSpotData,
  'stripe': fetchStripeData,
  'shopify': fetchShopifyData,
  'notion': fetchNotionData,
  'github': fetchGitHubData,
  'trello': (k, c) => fetchGenericProjectData(k, c, 'trello'),
  'asana': (k, c) => fetchGenericProjectData(k, c, 'asana'),
  'clickup': (k, c) => fetchGenericProjectData(k, c, 'clickup'),
  'jira': (k, c) => fetchGenericProjectData(k, c, 'jira'),
};

// ============================================================================
// MATON DATA INJECTION - Orchestrates multi-service pre-fetch
// ============================================================================

async function injectMatonData(
  messages: { role: string; content: string }[],
  matonApiKey: string,
): Promise<string> {
  const detectedApps = detectServiceIntents(messages);
  if (!detectedApps.length) return '';

  console.log('Detected service intents:', detectedApps);
  const connections = await getMatonConnections(matonApiKey);
  const connMap = new Map<string, string>();
  for (const c of connections) {
    if (!connMap.has(c.app)) connMap.set(c.app, c.connection_id);
  }

  const sections: string[] = [];
  const notConnected: string[] = [];

  // Fetch all detected services in parallel
  const fetchPromises = detectedApps.map(async (app) => {
    const connId = connMap.get(app);
    if (!connId) {
      const label = SERVICE_DETECTORS.find(s => s.app === app)?.label || app;
      notConnected.push(label);
      return;
    }
    const fetcher = SERVICE_FETCHERS[app];
    if (!fetcher) {
      sections.push(`## ${app}\nConnected but no data fetcher configured yet.`);
      return;
    }
    try {
      const data = await fetcher(matonApiKey, connId);
      const label = SERVICE_DETECTORS.find(s => s.app === app)?.label || app;
      sections.push(`## ${label}\n${data}`);
      console.log(`${app} data injected`);
    } catch (e) {
      console.error(`Error fetching ${app}:`, e);
      sections.push(`## ${app}\nError fetching data: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  });

  await Promise.all(fetchPromises);

  if (!sections.length && !notConnected.length) return '';

  let injection = `\n\n===========================================================
LIVE DATA FROM CONNECTED SERVICES
===========================================================
The following is REAL data pulled from the user's connected accounts via Maton AI. Use this data to answer their question with specific numbers, dates, and details. Analyze trends and provide actionable insights.\n\n`;

  injection += sections.join('\n\n');

  if (notConnected.length) {
    injection += `\n\nNote: The user asked about ${notConnected.join(', ')} but ${notConnected.length === 1 ? "it isn't" : "they aren't"} connected yet. Let them know they can connect ${notConnected.length === 1 ? 'it' : 'them'} in Settings > Maton AI Integrations.`;
  }

  return injection;
}

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
