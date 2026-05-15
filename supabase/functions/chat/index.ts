import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callWithFallback, loadUserPrefs, logRouting, loadCustomModels, mergeRegistry, MODEL_REGISTRY as MODEL_REGISTRY_BASE, DEFAULT_PREFS, type UserPrefs, type ModelEntry } from "../_shared/model-registry.ts";
import { getAllRegisteredTools } from "../_shared/integrations/index.ts";
import {
  getInstalledSkills,
  buildSkillIndex,
  formatSkillIndexForPrompt,
  getSkillBySlug,
  recordInvocation,
  filterSkillsByMode,
} from "../_shared/skills/registry.ts";
import { dispatchTool, dispatchMulti } from "../_shared/integrations/_dispatcher.ts";
import { GHL_TOOL_SCOPES as GHL_TOOL_REQUIRED_SCOPES } from "../_shared/integrations/ghl-scopes.ts";
import { buildSignalEnvelope, pickAccountByPriority } from "../_shared/signals/builder.ts";
import { renderForChatPrompt } from "../_shared/signals/render.ts";
import type { Entity } from "../_shared/signals/entities.ts";

// Local alias preserves prior `MODEL_REGISTRY` references at call sites that expect ModelEntry shape.
// (The local `MODEL_REGISTRY: Record<string, ModelConfig>` declared below is the chat-side config map.)
// Lovable AI Gateway key (used by web_search_google and a few helpers).
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
// Local type for per-account alias entries used by tool routing.
type AliasEntry = { alias: string; connectionId: string; provider?: string; email?: string };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map a model id to a friendly platform label for UI attribution.
function inferPlatformFromModel(modelId: string): string {
  const m = (modelId || '').toLowerCase();
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.includes('openai')) return 'OpenAI';
  if (m.includes('gemini') || m.startsWith('google/')) return 'Gemini';
  if (m.includes('claude') || m.includes('anthropic')) return 'Anthropic';
  if (m.includes('grok') || m.includes('xai')) return 'xAI';
  if (m.includes('mistral')) return 'Mistral';
  if (m.includes('llama') || m.includes('groq')) return 'Groq';
  if (m.includes('deepseek')) return 'DeepSeek';
  return 'Ozlon';
}

// ============================================================================
// MODEL ROUTER
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
  'gpt-5.4': {
    name: 'gpt-5.4',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    maxTokens: 16384,
    supportsStreaming: true,
    supportsTools: true,
  },
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

const DEFAULT_MODEL = 'gpt-5.4';

// ============================================================================
// MODEL FAILOVER CHAIN
// Auto-rotates through providers when one fails (quota/auth/exhausted retries).
// Chat must never lapse because a single key/provider is degraded.
// ============================================================================

type FailoverReason = 'transient' | 'quota' | 'auth' | 'bad_request' | 'unknown' | 'no_key';

interface ChainEntry {
  label: string;          // e.g. "openai-direct:gpt-5.4"
  endpoint: string;
  apiKeyEnvVar: string;
  model: string;          // model id sent in request body
  provider: 'openai' | 'lovable';
}

const LOVABLE_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

function chainFor(modelName: string): ChainEntry[] {
  // Normalize: registry stores resolved names like 'gpt-5.4', 'gpt-5-2025-08-07', etc.
  // Map to a Lovable-gateway-compatible primary if available.
  const m = modelName.toLowerCase();
  let primaryGateway: string | null = null;
  if (m.startsWith('gpt-5.4')) primaryGateway = 'openai/gpt-5.4';
  else if (m.startsWith('gpt-5-mini')) primaryGateway = 'openai/gpt-5-mini';
  else if (m.startsWith('gpt-5')) primaryGateway = 'openai/gpt-5';
  else if (m.startsWith('gpt-4.1')) primaryGateway = 'openai/gpt-5-mini'; // closest gateway peer

  const chain: ChainEntry[] = [
    {
      label: `openai-direct:${modelName}`,
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      model: modelName,
      provider: 'openai',
    },
  ];
  if (primaryGateway) {
    chain.push({
      label: `lovable:${primaryGateway}`,
      endpoint: LOVABLE_GATEWAY,
      apiKeyEnvVar: 'LOVABLE_API_KEY',
      model: primaryGateway,
      provider: 'lovable',
    });
  }
  // Universal terminal fallbacks — keep chat alive on any single-provider outage.
  chain.push(
    {
      label: 'lovable:openai/gpt-5',
      endpoint: LOVABLE_GATEWAY,
      apiKeyEnvVar: 'LOVABLE_API_KEY',
      model: 'openai/gpt-5',
      provider: 'lovable',
    },
    {
      label: 'lovable:google/gemini-3-flash-preview',
      endpoint: LOVABLE_GATEWAY,
      apiKeyEnvVar: 'LOVABLE_API_KEY',
      model: 'google/gemini-3-flash-preview',
      provider: 'lovable',
    },
    {
      label: 'lovable:google/gemini-2.5-flash',
      endpoint: LOVABLE_GATEWAY,
      apiKeyEnvVar: 'LOVABLE_API_KEY',
      model: 'google/gemini-2.5-flash',
      provider: 'lovable',
    },
  );
  // De-dupe by label (in case primary already matches a terminal fallback).
  const seen = new Set<string>();
  return chain.filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)));
}

function classifyHttpError(status: number, body: string): FailoverReason {
  const b = (body || '').toLowerCase();
  if (status === 400) return 'bad_request';
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) {
    if (b.includes('insufficient_quota') || b.includes('exceeded_quota') || b.includes('billing')) return 'quota';
    return 'transient';
  }
  if (status === 502 || status === 503 || status === 504) return 'transient';
  return 'unknown';
}

interface FailoverResult {
  response: Response;
  used: ChainEntry;
  failoverFrom?: string;
  failoverReason?: FailoverReason;
}

/**
 * Attempt a chat-completions call against an ordered chain of providers.
 * Per entry: up to 3 retries on transient errors. On quota/auth/exhausted →
 * advance to next entry. Throws only if the entire chain fails.
 */
async function callModelWithFallback(
  chain: ChainEntry[],
  payloadFor: (entry: ChainEntry) => Record<string, unknown>,
): Promise<FailoverResult> {
  let lastErr = '';
  let lastStatus = 0;
  const primaryLabel = chain[0]?.label;
  let advancedFrom: string | undefined;
  let advancedReason: FailoverReason | undefined;

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const key = Deno.env.get(entry.apiKeyEnvVar);
    if (!key) {
      console.warn(`[failover] ${entry.label}: missing ${entry.apiKeyEnvVar}, advancing`);
      if (i === 0) { advancedFrom = entry.label; advancedReason = 'no_key'; }
      continue;
    }
    let attempt = 0;
    while (attempt < 3) {
      const resp = await fetch(entry.endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFor(entry)),
      });
      if (resp.ok) {
        if (i > 0) {
          console.log(`[failover] succeeded via ${entry.label} (from=${advancedFrom || primaryLabel} reason=${advancedReason})`);
        }
        return {
          response: resp,
          used: entry,
          failoverFrom: i > 0 ? (advancedFrom || primaryLabel) : undefined,
          failoverReason: i > 0 ? advancedReason : undefined,
        };
      }
      lastStatus = resp.status;
      lastErr = await resp.text().catch(() => '');
      const reason = classifyHttpError(resp.status, lastErr);
      if (reason === 'bad_request') {
        // Our payload — don't fail over, surface immediately.
        throw new Error(`AI bad_request (${entry.label}): ${lastErr.slice(0, 300)}`);
      }
      if (reason === 'transient' && attempt < 2) {
        const delay = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        console.warn(`[failover] ${entry.label} transient ${resp.status}, retry in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        continue;
      }
      // quota / auth / exhausted-retries → advance to next entry
      console.warn(`[failover] ${entry.label} ${reason} (status=${resp.status}), advancing. body=${lastErr.slice(0, 200)}`);
      if (i === 0 || !advancedFrom) { advancedFrom = entry.label; advancedReason = reason; }
      break;
    }
  }
  throw new Error(`AI service exhausted all fallbacks. last=${lastStatus} ${lastErr.slice(0, 300)}`);
}

// ============================================================================
// NATIVE CONNECTION DISCOVERY
// All Google services route through native edge functions; we discover which
// services are available by inspecting integration_connections.
// ============================================================================

// Multi-account connection support (kept for compatibility with resolver/aliases)
type ConnEntry = { id: string; email?: string; meta?: Record<string, unknown> };
type MultiConnMap = Map<string, ConnEntry[]>;

interface NativeConnection {
  app: string;
  connection_id: string;
  metadata?: Record<string, unknown>;
}

/**
 * Discover the user's native connections from integration_connections.
 * A single Google OAuth connection (provider='youtube', auth_type='oauth2')
 * grants access to ALL Google services (Gmail, Calendar, Drive, Docs, Sheets,
 * Slides, GSC, GA, YouTube) via the shared google-token helper.
 */
async function getNativeConnections(userId: string): Promise<NativeConnection[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return [];

  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: rows } = await admin
      .from('integration_connections')
      .select('id, provider, auth_type, status, external_account_label, external_account_id, metadata')
      .eq('user_id', userId)
      .eq('status', 'connected');

    if (!rows?.length) return [];

    const connections: NativeConnection[] = [];
    const googleApps = [
      'google-mail', 'google-calendar', 'google-drive', 'google-docs',
      'google-sheets', 'google-slides', 'google-search-console',
      'google-analytics-data', 'google-meet',
    ];

    for (const r of rows) {
      const meta = (r.metadata || {}) as Record<string, unknown>;
      const email = (r.external_account_label as string) || (meta.email as string) || undefined;
      const enrichedMeta = { ...meta, email };

      if (r.provider === 'youtube' && r.auth_type === 'oauth2') {
        // Google OAuth grants access to YouTube + all Google Workspace services
        connections.push({ app: 'youtube', connection_id: r.id, metadata: enrichedMeta });
        for (const app of googleApps) {
          connections.push({ app, connection_id: r.id, metadata: enrichedMeta });
        }
      } else if (r.provider === 'youtube' && r.auth_type === 'api_key') {
        // Local YouTube API-key integration (read-only YouTube only)
        connections.push({ app: 'youtube', connection_id: r.id, metadata: enrichedMeta });
      } else if (r.provider === 'clickup') {
        connections.push({ app: 'clickup', connection_id: r.id, metadata: enrichedMeta });
      }
    }

    console.log(`[Native] ${connections.length} connection-app entries loaded`);
    return connections;
  } catch (e) {
    console.error('[Native] Connection discovery error:', e);
    return [];
  }
}

function buildMultiConnMap(connections: NativeConnection[]): MultiConnMap {
  const map: MultiConnMap = new Map();
  for (const c of connections) {
    const existing = map.get(c.app) || [];
    existing.push({
      id: c.connection_id,
      email: (c.metadata as Record<string, string>)?.email || undefined,
      meta: c.metadata,
    });
    map.set(c.app, existing);
  }
  return map;
}

// ============================================================================
// SERVICE INTENT DETECTION
// ============================================================================

interface ServiceDetection {
  app: string;
  label: string;
  keywords: string[];
}

const SERVICE_DETECTORS: ServiceDetection[] = [
  { app: 'google-search-console', label: 'Google Search Console', keywords: ['search console', 'gsc', 'seo', 'search performance', 'impressions', 'clicks', 'search queries', 'keyword', 'ranking', 'serp', 'search traffic', 'ctr', 'click-through', 'search analytics', 'organic search', 'web traffic'] },
  { app: 'google-mail', label: 'Gmail', keywords: ['email', 'emails', 'gmail', 'mail', 'inbox', 'unread', 'messages', 'send email', 'draft', 'newsletter'] },
  { app: 'google-calendar', label: 'Google Calendar', keywords: ['calendar', 'schedule', 'meeting', 'meetings', 'event', 'events', 'appointment', 'appointments', 'busy', 'free time', 'availability', 'agenda', 'tomorrow', 'this week', 'next week'] },
  { app: 'google-drive', label: 'Google Drive', keywords: ['drive', 'google drive', 'files', 'folder', 'shared drive', 'my drive'] },
  { app: 'google-docs', label: 'Google Docs', keywords: ['google doc', 'google docs', 'gdoc', 'gdocs', 'create a doc', 'write a doc', 'document'] },
  { app: 'google-sheets', label: 'Google Sheets', keywords: ['google sheet', 'google sheets', 'spreadsheet', 'spreadsheets', 'gsheet', 'gsheets', 'csv data', 'rows and columns'] },
  { app: 'google-slides', label: 'Google Slides', keywords: ['google slides', 'presentation', 'presentations', 'slide deck', 'slides', 'gslides'] },
  { app: 'youtube', label: 'YouTube', keywords: ['youtube', 'video', 'videos', 'channel', 'subscribers', 'views', 'youtube analytics', 'uploads', 'my channel'] },
  { app: 'google-meet', label: 'Google Meet', keywords: ['google meet', 'meet', 'video call', 'video meeting', 'gmeet'] },
  { app: 'google-analytics-data', label: 'Google Analytics', keywords: ['analytics', 'google analytics', 'ga4', 'page views', 'sessions', 'bounce rate', 'visitors', 'website traffic', 'site traffic', 'user behavior'] },
  { app: 'clickup', label: 'ClickUp', keywords: ['clickup', 'click up', 'clickup task', 'clickup tasks', 'task management'] },
  { app: 'gohighlevel', label: 'GoHighLevel', keywords: ['gohighlevel', 'ghl', 'high level', 'highlevel', 'go high level', 'leadconnector', 'lead connector', 'sub-account', 'subaccount', 'pipeline', 'pipelines', 'opportunity', 'opportunities', 'funnels', 'funnel', 'workflows', 'workflow', 'campaigns', 'campaign', 'conversations', 'conversation', 'invoice', 'invoices', 'orders', 'transactions', 'crm contacts', 'custom fields', 'custom values', 'form submissions', 'social post', 'social media post', 'social planner', 'social accounts', 'products', 'product', 'store items', 'courses', 'course', 'training', 'surveys', 'survey', 'survey responses', 'blog', 'blogs', 'blog post', 'blog posts', 'articles', 'media files', 'media library', 'companies', 'company', 'links', 'tracking links', 'trigger links', 'businesses', 'business'] },
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
// NATIVE EDGE INVOKER (for service data fetchers)
// Forward-declared minimally; full helper is defined later for tool handlers.
// ============================================================================
async function invokeNativeEdge(
  fn: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
  if (!authHeader) throw new Error('No auth context — user must be signed in');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, params }),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data?.success === false) {
    const errMsg = (data?.error as string) || (data?.raw as string) || `${fn}/${action} failed (${res.status})`;
    throw new Error(errMsg);
  }
  return data;
}

// ============================================================================
// SERVICE DATA FETCHERS (READ) — All native Google edge functions.
// ============================================================================

async function fetchGSCData(): Promise<string> {
  console.log(`[GSC] Fetching sites via native edge`);
  let sitesData: { siteEntry?: { siteUrl: string; permissionLevel?: string }[] };
  try {
    const r = await invokeNativeEdge('google-search-console', 'list_sites');
    sitesData = r as typeof sitesData;
  } catch (e) {
    console.error('[GSC] Failed to fetch sites:', e);
    return `Failed to fetch GSC sites: ${e instanceof Error ? e.message : 'Unknown error'}. The connection may need to be re-authorized.`;
  }
  const sites = sitesData.siteEntry || [];
  if (!sites.length) return 'No sites found in Google Search Console. Make sure your GSC account has verified properties.';
  console.log(`[GSC] Found ${sites.length} sites`);
  const recentEnd = new Date(); recentEnd.setDate(recentEnd.getDate() - 2);
  const recentStart = new Date(); recentStart.setDate(recentStart.getDate() - 8);
  const priorEnd = new Date(); priorEnd.setDate(priorEnd.getDate() - 9);
  const priorStart = new Date(); priorStart.setDate(priorStart.getDate() - 15);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const reports: string[] = [];
  for (const site of sites) {
    try {
      const [recentQueryData, priorQueryData, recentPageData, recentDateData] = await Promise.all([
        invokeNativeEdge('google-search-console', 'search_analytics', { siteUrl: site.siteUrl, request: { startDate: fmt(recentStart), endDate: fmt(recentEnd), dimensions: ['query'], rowLimit: 50 } }),
        invokeNativeEdge('google-search-console', 'search_analytics', { siteUrl: site.siteUrl, request: { startDate: fmt(priorStart), endDate: fmt(priorEnd), dimensions: ['query'], rowLimit: 50 } }),
        invokeNativeEdge('google-search-console', 'search_analytics', { siteUrl: site.siteUrl, request: { startDate: fmt(recentStart), endDate: fmt(recentEnd), dimensions: ['page'], rowLimit: 25 } }),
        invokeNativeEdge('google-search-console', 'search_analytics', { siteUrl: site.siteUrl, request: { startDate: fmt(recentStart), endDate: fmt(recentEnd), dimensions: ['date'], rowLimit: 7 } }),
      ]) as [
        { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] },
        { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] },
        { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] },
        { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] },
      ];
      const rRows = recentQueryData.rows || []; const pRows = priorQueryData.rows || [];
      const pageRows = recentPageData.rows || []; const dateRows = recentDateData.rows || [];
      const rT = rRows.reduce((a, r) => ({ c: a.c + r.clicks, i: a.i + r.impressions, ctr: 0, pos: 0 }), { c: 0, i: 0, ctr: 0, pos: 0 });
      const pT = pRows.reduce((a, r) => ({ c: a.c + r.clicks, i: a.i + r.impressions }), { c: 0, i: 0 });
      rT.ctr = rT.i > 0 ? rT.c / rT.i : 0;
      let r = `### ${site.siteUrl}\n`;
      r += `**Last 7 days (${fmt(recentStart)} to ${fmt(recentEnd)}):** ${rT.c} clicks, ${rT.i} impressions, ${(rT.ctr * 100).toFixed(1)}% CTR\n`;
      r += `**Prior 7 days (${fmt(priorStart)} to ${fmt(priorEnd)}):** ${pT.c} clicks, ${pT.i} impressions\n`;
      const clickChange = pT.c > 0 ? ((rT.c - pT.c) / pT.c * 100).toFixed(1) : 'N/A';
      const impChange = pT.i > 0 ? ((rT.i - pT.i) / pT.i * 100).toFixed(1) : 'N/A';
      r += `**Change:** Clicks ${clickChange}% | Impressions ${impChange}%\n`;
      if (rRows.length) { r += '\n**Top queries:**\n'; for (const row of rRows.slice(0, 15)) r += `- "${row.keys[0]}": ${row.clicks} clicks, ${row.impressions} imp, pos ${row.position.toFixed(1)}, CTR ${(row.ctr*100).toFixed(1)}%\n`; }
      if (pageRows.length) { r += '\n**Top pages:**\n'; for (const row of pageRows.slice(0, 10)) r += `- ${row.keys[0]}: ${row.clicks} clicks, ${row.impressions} imp, CTR ${(row.ctr*100).toFixed(1)}%\n`; }
      if (dateRows.length) { r += '\n**Daily trend:**\n'; for (const row of dateRows) r += `- ${row.keys[0]}: ${row.clicks} clicks, ${row.impressions} imp\n`; }
      reports.push(r);
    } catch (e) {
      console.error(`[GSC] Error fetching data for ${site.siteUrl}:`, e);
      reports.push(`### ${site.siteUrl}\nError: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }
  return reports.join('\n');
}

async function fetchGmailData(): Promise<string> {
  const [recentData, unreadData] = await Promise.all([
    invokeNativeEdge('google-gmail', 'list_messages', { maxResults: 20 }) as Promise<{ messages?: { id: string }[]; resultSizeEstimate?: number }>,
    invokeNativeEdge('google-gmail', 'list_messages', { maxResults: 1, q: 'is:unread' }).catch(() => ({} as { resultSizeEstimate?: number })),
  ]);
  const msgs = recentData.messages || [];
  if (!msgs.length) return 'Inbox is empty.';
  const unreadCount = unreadData.resultSizeEstimate || 0;
  const details: string[] = [`Latest emails (newest first) | Unread: ~${unreadCount}`];
  const batch = msgs.slice(0, 15);
  const results = await Promise.all(batch.map(async (m) => {
    try {
      const full = await invokeNativeEdge('google-gmail', 'get_message', { id: m.id, format: 'full' });
      const message = full.message as { payload?: { headers?: { name: string; value: string }[] }; snippet?: string; labelIds?: string[] } | undefined;
      const headers = message?.payload?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const date = headers.find(h => h.name === 'Date')?.value || '';
      const unread = (message?.labelIds || []).includes('UNREAD') ? ' [UNREAD]' : '';
      return `- ID: ${m.id} | From: ${from} | Subject: ${subject} | ${date}${unread}\n  Preview: ${(message?.snippet || '').substring(0, 120)}`;
    } catch { return `- ID: ${m.id}: could not load`; }
  }));
  details.push(...results);
  return details.join('\n');
}

async function fetchCalendarData(): Promise<string> {
  const now = new Date();
  const end = new Date(); end.setDate(end.getDate() + 7);
  const data = await invokeNativeEdge('google-calendar', 'list_events', {
    calendarId: 'primary', timeMin: now.toISOString(), timeMax: end.toISOString(), maxResults: 20, singleEvents: true,
  }) as { items?: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }[] };
  const events = data.items || [];
  if (!events.length) return 'No upcoming events in the next 7 days.';
  return events.map(e => `- ${e.summary || '(no title)'} | ${e.start?.dateTime || e.start?.date || 'TBD'}${e.location ? ' | ' + e.location : ''}`).join('\n');
}

async function fetchGoogleDriveData(): Promise<string> {
  const data = await invokeNativeEdge('google-drive', 'list_files', { pageSize: 15, orderBy: 'modifiedTime desc' }) as { files?: { name: string; mimeType: string; modifiedTime: string }[] };
  const files = data.files || [];
  if (!files.length) return 'No recent files.';
  return files.map(f => `- ${f.name} (${f.mimeType?.split('.').pop() || 'file'}) - modified ${f.modifiedTime}`).join('\n');
}

async function fetchGoogleDocsData(): Promise<string> {
  const data = await invokeNativeEdge('google-docs', 'list_documents', { pageSize: 15 }) as { files?: { id: string; name: string; modifiedTime: string; webViewLink?: string }[] };
  const files = data.files || [];
  if (!files.length) return 'No Google Docs found.';
  return files.map(f => `- [${f.name}](${f.webViewLink || `https://docs.google.com/document/d/${f.id}/edit`}) — modified ${f.modifiedTime}`).join('\n');
}

async function fetchGoogleSheetsData(): Promise<string> {
  // Native google-sheets edge has list_spreadsheets action (Drive-backed listing)
  const data = await invokeNativeEdge('google-sheets', 'list_spreadsheets', { pageSize: 15 }) as { files?: { id: string; name: string; modifiedTime: string; webViewLink?: string }[] };
  const files = data.files || [];
  if (!files.length) return 'No Google Sheets found.';
  return files.map(f => `- [${f.name}](${f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`}) — modified ${f.modifiedTime}`).join('\n');
}

async function fetchGoogleSlidesData(): Promise<string> {
  try {
    const data = await invokeNativeEdge('google-slides', 'list_presentations', { pageSize: 15 }) as { files?: { id: string; name: string; modifiedTime: string; webViewLink?: string }[] };
    const files = data.files || [];
    if (!files.length) return 'No Google Slides found.';
    return files.map(f => `- [${f.name}](${f.webViewLink || `https://docs.google.com/presentation/d/${f.id}/edit`}) — modified ${f.modifiedTime}`).join('\n');
  } catch (e) {
    return `Google Slides error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function fetchYouTubeData(userId?: string): Promise<string> {
  // Native youtube edge has no list_my_channels/list_my_videos actions —
  // read from the synced youtube_channels / youtube_videos tables instead.
  if (!userId) return 'YouTube connected but no synced data available (missing user context).';
  return (await fetchYouTubeLocalData(userId)) || 'YouTube connected but no synced channel data yet. Run a sync from Integrations > YouTube.';
}

// ---------- YouTube (local Integration Hub fallback for api-key connections) ----------
async function fetchYouTubeLocalData(userId: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return null;

  const { createClient: cc1 } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
  const adminClient = cc1(supabaseUrl, serviceRoleKey);

  // Prefer the connection that actually has synced channel data; fall back to most recent connected.
  const { data: channelsAll } = await adminClient
    .from('youtube_channels')
    .select('connection_id, title, subscriber_count, video_count, view_count, fetched_at')
    .eq('user_id', userId)
    .order('fetched_at', { ascending: false })
    .limit(1);

  const channel = channelsAll?.[0];
  const connectionId = channel?.connection_id;

  if (!connectionId) {
    // No synced data — check if any connection exists at all
    const { data: anyConn } = await adminClient
      .from('integration_connections')
      .select('id, status')
      .eq('user_id', userId)
      .eq('provider', 'youtube')
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle();
    if (!anyConn?.id) return null;
    return 'YouTube is connected, but no channel data has been synced yet. Run a sync from Integrations > YouTube.';
  }

  const { data: videos } = await adminClient
    .from('youtube_videos')
    .select('video_id, title, published_at, view_count, like_count, comment_count')
    .eq('user_id', userId)
    .eq('connection_id', connectionId)
    .order('published_at', { ascending: false })
    .limit(10);

  let result = '';
  result += `**Channel:** ${channel.title || 'Unknown'}\n`;
  result += `Subscribers: ${channel.subscriber_count ?? '?'} | Videos: ${channel.video_count ?? '?'} | Total views: ${channel.view_count ?? '?'}\n\n`;
  if (videos?.length) {
    result += 'Recent uploads:\n';
    result += videos.map((v: any) => {
      const stats = [
        v.view_count != null ? `${Number(v.view_count).toLocaleString()} views` : null,
        v.like_count != null ? `${Number(v.like_count).toLocaleString()} likes` : null,
        v.comment_count != null ? `${Number(v.comment_count).toLocaleString()} comments` : null,
      ].filter(Boolean).join(', ');
      return `- [${v.title || '(untitled)'}](https://youtube.com/watch?v=${v.video_id}) — ${v.published_at || ''}${stats ? ` (${stats})` : ''}`;
    }).join('\n');
  }
  return result || 'YouTube is connected locally, but no synced channel/video data is available yet.';
}

// ---------- ClickUp (local Integration Hub) ----------
async function fetchClickUpLocalData(userId: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return null;

  const { createClient: cc2 } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
  const adminClient = cc2(supabaseUrl, serviceRoleKey);
  const { data: config, error } = await adminClient
    .from('clickup_integration_state')
    .select('team_id, default_list_id, webhook_status, last_webhook_event_at, last_successful_ai_reply_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !config) return null;

  let processedCount = 0;
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await adminClient
      .from('clickup_processed_comments')
      .select('id', { count: 'exact', head: true })
      .gte('handled_at', sevenDaysAgo)
      .eq('status', 'processed');
    processedCount = count || 0;
  } catch { processedCount = 0; }

  return [
    `**Workspace Team ID:** ${config.team_id || 'Not set'}`,
    `Default list: ${config.default_list_id || 'Not set'}`,
    `Webhook status: ${config.webhook_status || 'unknown'}`,
    `Last webhook event: ${config.last_webhook_event_at || 'n/a'}`,
    `Last successful AI reply: ${config.last_successful_ai_reply_at || 'n/a'}`,
    `Processed comments (7d): ${processedCount}`,
  ].join('\n');
}

// ---------- Google Meet (via Calendar) ----------
async function fetchGoogleMeetData(): Promise<string> {
  const now = new Date();
  const end = new Date(); end.setDate(end.getDate() + 14);
  const data = await invokeNativeEdge('google-calendar', 'list_events', {
    calendarId: 'primary', timeMin: now.toISOString(), timeMax: end.toISOString(), maxResults: 20, singleEvents: true, q: 'meet.google.com',
  }) as { items?: { summary?: string; start?: { dateTime?: string; date?: string }; hangoutLink?: string; htmlLink?: string }[] };
  const events = data.items || [];
  if (!events.length) return 'No upcoming Google Meet meetings found.';
  return events.map(e => `- ${e.summary || '(no title)'} | ${e.start?.dateTime || e.start?.date || 'TBD'} | ${e.hangoutLink || e.htmlLink || ''}`).join('\n');
}

// ---------- ClickUp (via dedicated edge function) ----------
async function callClickUpEdge(action: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const clickupUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/clickup`;
  // Forward the end-user's JWT so the clickup function's vault-first resolver can identify them.
  // Fall back to service role only if no user context is available (e.g. background tasks).
  const userAuthHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
  const authHeader = userAuthHeader || `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  const res = await fetch(clickupUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify({ action, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'ClickUp edge function error' }));
    throw new Error(err.error || `ClickUp edge function returned ${res.status}`);
  }
  return res.json();
}

async function fetchClickUpData(): Promise<string> {
  try {
    const result = await callClickUpEdge('test_connection');
    if (!result.connected) return 'ClickUp is not connected. Configure the API token in Integrations → ClickUp.';
    const spacesResult = await callClickUpEdge('list_spaces') as { spaces?: { id: string; name: string }[] };
    const spaces = spacesResult.spaces || [];
    if (!spaces.length) return 'ClickUp connected but no spaces found.';
    const sections: string[] = [];
    for (const space of spaces.slice(0, 3)) {
      let section = `**Space:** ${space.name}\n`;
      try {
        const listsResult = await callClickUpEdge('list_lists', { spaceId: space.id }) as { lists?: { id: string; name: string; task_count?: number }[] };
        const lists = listsResult.lists || [];
        for (const list of lists.slice(0, 5)) {
          section += `  - ${list.name} (${list.task_count || 0} tasks) [list_id: ${list.id}]\n`;
        }
      } catch { section += '  - Could not load lists\n'; }
      sections.push(section);
    }
    return sections.join('\n');
  } catch (err) {
    return `ClickUp error: ${(err as Error).message}`;
  }
}

// ---------- Google Analytics (GA4) ----------
async function fetchGoogleAnalyticsData(): Promise<string> {
  try {
    const accountsData = await invokeNativeEdge('google-analytics', 'list_accounts', {}) as { accounts?: { name?: string; displayName?: string }[] };
    const accounts = accountsData.accounts || [];
    if (!accounts.length) return 'No Google Analytics accounts found.';
    const accountId = (accounts[0].name || '').replace('accounts/', '');
    if (!accountId) return 'No Google Analytics account ID resolved.';
    const propsData = await invokeNativeEdge('google-analytics', 'list_properties', { accountId }) as { properties?: { name?: string; displayName?: string }[] };
    const properties = propsData.properties || [];
    if (!properties.length) return `GA Account: ${accounts[0].displayName}\nNo GA4 properties found under this account.`;
    const prop = { property: properties[0].name, displayName: properties[0].displayName };
    if (!prop.property) return 'No GA4 properties found.';
    const propertyId = prop.property.replace('properties/', '');
    const reportData = await invokeNativeEdge('google-analytics', 'run_report', {
      propertyId,
      report: {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'bounceRate' }],
        dimensions: [{ name: 'date' }],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      },
    }) as { rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] };
    const rows = reportData.rows || [];
    if (!rows.length) return `GA4 Property: ${prop.displayName}\nNo data in the last 7 days.`;
    let result = `**GA4 Property:** ${prop.displayName}\n**Last 7 days:**\n`;
    const totals = { users: 0, sessions: 0, pageviews: 0 };
    for (const row of rows) {
      const date = row.dimensionValues?.[0]?.value || '?';
      const users = parseInt(row.metricValues?.[0]?.value || '0');
      const sessions = parseInt(row.metricValues?.[1]?.value || '0');
      const pv = parseInt(row.metricValues?.[2]?.value || '0');
      totals.users += users; totals.sessions += sessions; totals.pageviews += pv;
      result += `- ${date}: ${users} users, ${sessions} sessions, ${pv} pageviews\n`;
    }
    result += `\n**Totals:** ${totals.users} users, ${totals.sessions} sessions, ${totals.pageviews} pageviews`;
    return result;
  } catch (e) { return `Google Analytics error: ${e instanceof Error ? e.message : 'Unknown'}`; }
}

const SERVICE_FETCHERS: Record<string, () => Promise<string>> = {
  'google-search-console': fetchGSCData,
  'google-mail': fetchGmailData,
  'google-calendar': fetchCalendarData,
  'google-drive': fetchGoogleDriveData,
  'google-docs': fetchGoogleDocsData,
  'google-sheets': fetchGoogleSheetsData,
  'google-slides': fetchGoogleSlidesData,
  'youtube': fetchYouTubeData,
  'google-meet': fetchGoogleMeetData,
  'google-analytics-data': fetchGoogleAnalyticsData,
  'clickup': fetchClickUpData,
};

// ============================================================================
// NATIVE DATA INJECTION (READ)
// Pre-fetches data for services the user is asking about, using native edges.
// ============================================================================

async function injectNativeData(
  messages: { role: string; content: string }[],
  multiConnMap: MultiConnMap,
  userId?: string | null,
): Promise<string> {
  const detectedApps = detectServiceIntents(messages);
  if (!detectedApps.length) return '';
  console.log('Detected service intents:', detectedApps);

  const sections: string[] = [];
  const notConnected: string[] = [];

  await Promise.all(detectedApps.map(async (app) => {
    // YouTube: read from synced youtube_channels / youtube_videos tables (works for both OAuth and api_key)
    if (app === 'youtube') {
      const localData = userId ? await fetchYouTubeLocalData(userId) : null;
      if (localData) {
        sections.push(`## YouTube\n${localData}`);
        return;
      }
      notConnected.push('YouTube');
      return;
    }

    // ClickUp uses its own edge function — bypass connMap check
    if (app === 'clickup') {
      const localData = userId ? await fetchClickUpLocalData(userId) : null;
      if (localData) {
        sections.push(`## ClickUp\n${localData}`);
        return;
      }
      try {
        const data = await fetchClickUpData();
        sections.push(`## ClickUp\n${data}`);
      } catch (e) {
        notConnected.push('ClickUp');
        console.error('[ClickUp] error:', e);
      }
      return;
    }

    // Google services: require a Google OAuth connection (mapped via discovery)
    if (!multiConnMap.has(app)) {
      notConnected.push(SERVICE_DETECTORS.find(s => s.app === app)?.label || app);
      return;
    }

    const fetcher = SERVICE_FETCHERS[app];
    if (!fetcher) {
      sections.push(`## ${app}\nConnected but no data fetcher configured.`);
      return;
    }
    try {
      const data = await fetcher();
      sections.push(`## ${SERVICE_DETECTORS.find(s => s.app === app)?.label || app}\n${data}`);
      console.log(`${app} data injected`);
    } catch (e) {
      console.error(`Error fetching ${app}:`, e);
      sections.push(`## ${app}\nError: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }));

  if (!sections.length && !notConnected.length) return '';

  let injection = `\n\n===========================================================
LIVE DATA FROM CONNECTED SERVICES
===========================================================
The following is REAL data pulled from the user's connected accounts. Use this data to answer with specific numbers, dates, and details.\n\n`;
  injection += sections.join('\n\n');
  if (notConnected.length) {
    injection += `\n\nNote: The user asked about ${notConnected.join(', ')} but ${notConnected.length === 1 ? "it isn't" : "they aren't"} connected yet. Let them know they can connect in Settings > Integrations.`;
  }
  return injection;
}

// ============================================================================
// GOHIGHLEVEL DIRECT API HELPER
// ============================================================================

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

async function callGHL(path: string, method = 'GET', body?: unknown, ghlApiKey?: string): Promise<unknown> {
  // No env fallback — caller must pass a per-user key resolved from integration_connections.
  if (!ghlApiKey) throw new Error('GoHighLevel not connected. Add your API key in Integrations → Go High Level.');
  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${ghlApiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const payload: unknown = ct.includes('application/json')
    ? await res.json().catch(() => ({}))
    : { raw: await res.text() };
  if (!res.ok) {
    const detail = typeof payload === 'object' && payload !== null
      ? JSON.stringify(payload).slice(0, 500)
      : String(payload).slice(0, 500);
    console.error(`[callGHL] ${method} ${path} failed: ${res.status} ${detail}`);
    throw new Error(`GHL ${method} ${path} failed [${res.status}]: ${detail}`);
  }
  return payload;
}

async function fetchGHLData(ghlApiKey?: string, ghlLocationId?: string): Promise<string> {
  if (!ghlApiKey) return 'GoHighLevel not connected for this user.';
  if (!ghlLocationId) return 'GHL location not configured for this user.';
  const sections: string[] = [];
  const errors: string[] = [];
  const [contactsRes, pipelinesRes, calendarsRes] = await Promise.allSettled([
    callGHL(`/contacts/?locationId=${ghlLocationId}&limit=10`, 'GET', undefined, ghlApiKey) as Promise<{ contacts?: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string }[] }>,
    callGHL(`/opportunities/pipelines?locationId=${ghlLocationId}`, 'GET', undefined, ghlApiKey) as Promise<{ pipelines?: { id: string; name: string; stages?: { id: string; name: string }[] }[] }>,
    callGHL(`/calendars/?locationId=${ghlLocationId}`, 'GET', undefined, ghlApiKey) as Promise<{ calendars?: { id: string; name: string }[] }>,
  ]);
  if (contactsRes.status === 'fulfilled') {
    const contacts = contactsRes.value.contacts || [];
    if (contacts.length) sections.push(`**Recent Contacts (${contacts.length}):**\n${contacts.map(c => `- ${c.firstName || ''} ${c.lastName || ''} | ${c.email || ''} | ${c.phone || ''} | ID: ${c.id}`).join('\n')}`);
  } else {
    errors.push(`Contacts: ${contactsRes.reason instanceof Error ? contactsRes.reason.message : String(contactsRes.reason)}`);
  }
  if (pipelinesRes.status === 'fulfilled') {
    const pipelines = pipelinesRes.value.pipelines || [];
    if (pipelines.length) sections.push(`**Pipelines:**\n${pipelines.map(p => `- ${p.name} (ID: ${p.id}) — Stages: ${(p.stages || []).map(s => s.name).join(' → ')}`).join('\n')}`);
  } else {
    errors.push(`Pipelines: ${pipelinesRes.reason instanceof Error ? pipelinesRes.reason.message : String(pipelinesRes.reason)}`);
  }
  if (calendarsRes.status === 'fulfilled') {
    const calendars = calendarsRes.value.calendars || [];
    if (calendars.length) sections.push(`**Calendars:**\n${calendars.map(c => `- ${c.name} (ID: ${c.id})`).join('\n')}`);
  } else {
    errors.push(`Calendars: ${calendarsRes.reason instanceof Error ? calendarsRes.reason.message : String(calendarsRes.reason)}`);
  }
  if (errors.length) sections.push(`**Errors fetching some GHL data:**\n${errors.join('\n')}`);
  return sections.join('\n\n') || 'No GHL data found.';
}

// ============================================================================
// ACTION TOOL DEFINITIONS - Tools the AI can call to TAKE ACTIONS
// ============================================================================

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const ACTION_TOOLS: ToolDef[] = [
  // Gmail actions
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send an email via Gmail. Use when the user asks to send, compose, or email someone. If the user specifies which Gmail account to use (e.g. "from colin@ozlon.net"), pass the email as the account parameter.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body text (plain text)' },
          cc: { type: 'string', description: 'CC email address (optional)' },
          account: { type: 'string', description: 'Gmail account email to send from (optional, use when user specifies which account)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_email_draft',
      description: 'Create a draft email in Gmail for the user to review before sending.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body text' },
          account: { type: 'string', description: 'Gmail account email (optional, use when user specifies which account)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  // Gmail management tools
  {
    type: 'function',
    function: {
      name: 'list_emails',
      description: 'Search and list emails in Gmail. Use Gmail query syntax (e.g. "from:someone@example.com", "is:unread", "subject:invoice", "newer_than:7d"). Returns message IDs and metadata.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (e.g. "is:unread", "from:client@co.com", "subject:invoice newer_than:30d")' },
          max_results: { type: 'number', description: 'Max emails to return (default 20, max 100)' },
          account: { type: 'string', description: 'Gmail account email (optional, use when user specifies which account)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_email',
      description: 'Get full details of a specific email by its message ID, including sender, subject, date, and body content.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID' },
          account: { type: 'string', description: 'Gmail account email (optional)' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trash_email',
      description: 'Move a single email to trash by its message ID.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID to trash' },
          account: { type: 'string', description: 'Gmail account email (optional)' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_trash_emails',
      description: 'Move multiple emails to trash at once using individual trash calls in parallel. More efficient than trashing one-by-one. Use this when cleaning/filtering the inbox.',
      parameters: {
        type: 'object',
        properties: {
          message_ids: { type: 'string', description: 'Comma-separated Gmail message IDs to trash (up to 50 at a time)' },
          account: { type: 'string', description: 'Gmail account email (optional)' },
        },
        required: ['message_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_email_ids',
      description: 'Lightweight bulk email ID fetcher. Returns only message IDs (no metadata) for up to 500 emails matching a query. Use this first to see the full scope of emails before batch operations. Results are in newest-first order.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (e.g. "in:inbox -from:client@co.com")' },
          max_results: { type: 'number', description: 'Max IDs to return (default 100, max 500)' },
          page_token: { type: 'string', description: 'Pagination token from previous call (optional)' },
          account: { type: 'string', description: 'Gmail account email (optional)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'label_email',
      description: 'Add or remove labels on an email (INBOX, STARRED, IMPORTANT, UNREAD, SPAM, TRASH, or custom labels).',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID' },
          add_labels: { type: 'string', description: 'Comma-separated label IDs to add (optional)' },
          remove_labels: { type: 'string', description: 'Comma-separated label IDs to remove (optional)' },
          account: { type: 'string', description: 'Gmail account email (optional)' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_email_read',
      description: 'Mark an email as read (removes the UNREAD label).',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID' },
          account: { type: 'string', description: 'Gmail account email (optional)' },
        },
        required: ['message_id'],
      },
    },
  },
  // ─── Tier 1 Gmail tools migrated to manifest: see _shared/integrations/gmail.ts ───

  // Calendar actions
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description: 'Create a new Google Calendar event. Use when the user asks to schedule, book, or create a meeting/event.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start_time: { type: 'string', description: 'Start time in ISO 8601 format (e.g. 2025-01-15T10:00:00-05:00)' },
          end_time: { type: 'string', description: 'End time in ISO 8601 format' },
          description: { type: 'string', description: 'Event description (optional)' },
          location: { type: 'string', description: 'Event location (optional)' },
          attendees: { type: 'string', description: 'Comma-separated email addresses of attendees (optional)' },
        },
        required: ['summary', 'start_time', 'end_time'],
      },
    },
  },
  // Tier 2: Calendar Pro — additive, existing create_calendar_event untouched
  {
    type: 'function',
    function: {
      name: 'calendar_list_calendars',
      description: 'List all Google calendars the user has access to.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_list_events',
      description: 'List Google Calendar events in a time window.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string', description: "Calendar ID, default 'primary'" },
          timeMin: { type: 'string', description: 'ISO start time' },
          timeMax: { type: 'string', description: 'ISO end time' },
          q: { type: 'string', description: 'Optional text search' },
          maxResults: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_get_event',
      description: 'Get a specific Google Calendar event by ID.',
      parameters: { type: 'object', properties: { calendarId: { type: 'string' }, eventId: { type: 'string' } }, required: ['eventId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_update_event',
      description: 'Update a Google Calendar event (PATCH). Pass any subset of event fields.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          eventId: { type: 'string' },
          event: { type: 'object', description: 'Partial event object to merge' },
        },
        required: ['eventId', 'event'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_delete_event',
      description: 'Delete a Google Calendar event. Confirm with user first.',
      parameters: { type: 'object', properties: { calendarId: { type: 'string' }, eventId: { type: 'string' } }, required: ['eventId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_quick_add',
      description: 'Create a calendar event from a natural-language string (e.g. "Lunch with Sam tomorrow 1pm").',
      parameters: { type: 'object', properties: { calendarId: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_freebusy',
      description: 'Check free/busy times across one or more calendars.',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string' },
          timeMax: { type: 'string' },
          calendarIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['timeMin', 'timeMax'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_find_free_slots',
      description: 'Find available open slots of a given duration in a calendar within a window.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          timeMin: { type: 'string' },
          timeMax: { type: 'string' },
          durationMins: { type: 'number', description: 'Default 30' },
        },
        required: ['timeMin', 'timeMax'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_move_event',
      description: 'Move an event to a different calendar.',
      parameters: { type: 'object', properties: { calendarId: { type: 'string' }, eventId: { type: 'string' }, destination: { type: 'string' } }, required: ['eventId', 'destination'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_respond_to_event',
      description: 'Respond to a calendar invite (accept/decline/tentative) on behalf of an attendee email.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          eventId: { type: 'string' },
          attendeeEmail: { type: 'string' },
          responseStatus: { type: 'string', enum: ['accepted', 'declined', 'tentative', 'needsAction'] },
        },
        required: ['eventId', 'attendeeEmail', 'responseStatus'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_add_attendees',
      description: 'Add attendees to an existing event and notify them.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          eventId: { type: 'string' },
          attendees: { type: 'array', items: { type: 'string' } },
        },
        required: ['eventId', 'attendees'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_create_event_with_meet',
      description: 'Create a calendar event with an auto-generated Google Meet conference link.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          summary: { type: 'string' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          description: { type: 'string' },
          attendees: { type: 'string', description: 'Comma-separated emails' },
        },
        required: ['summary', 'start_time', 'end_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_create_calendar',
      description: 'Create a new secondary calendar.',
      parameters: { type: 'object', properties: { summary: { type: 'string' }, timeZone: { type: 'string' } }, required: ['summary'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_set_event_reminders',
      description: 'Set custom reminders on a calendar event (popup or email, with minutes-before list).',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          eventId: { type: 'string' },
          reminderMinutes: { type: 'array', items: { type: 'number' } },
          method: { type: 'string', enum: ['popup', 'email'] },
        },
        required: ['eventId', 'reminderMinutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_list_colors',
      description: 'List the color palette available for events and calendars.',
      parameters: { type: 'object', properties: {} },
    },
  },
  // Google Drive actions
  {
    type: 'function',
    function: {
      name: 'search_google_drive',
      description: 'Search for files in Google Drive by name or content.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          max_results: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  // Google Docs actions
  {
    type: 'function',
    function: {
      name: 'create_google_doc',
      description: 'Create a new Google Doc with a title and optional content.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title' },
          content: { type: 'string', description: 'Initial text content for the document (optional)' },
        },
        required: ['title'],
      },
    },
  },
  // Google Sheets actions
  {
    type: 'function',
    function: {
      name: 'create_google_sheet',
      description: 'Create a new Google Sheets spreadsheet.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Spreadsheet title' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_sheet_data',
      description: 'Read data from a Google Sheets spreadsheet by its ID.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'The spreadsheet ID (from its URL)' },
          range: { type: 'string', description: "Cell range to read, e.g. 'Sheet1!A1:D10'. Defaults to 'Sheet1'" },
        },
        required: ['spreadsheet_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_sheet_rows',
      description: 'Append rows of data to a Google Sheets spreadsheet.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'The spreadsheet ID' },
          range: { type: 'string', description: "Range to append to, e.g. 'Sheet1!A:D'. Defaults to 'Sheet1'" },
          values: { type: 'string', description: 'JSON array of arrays representing rows, e.g. [["Name","Email"],["John","john@example.com"]]' },
        },
        required: ['spreadsheet_id', 'values'],
      },
    },
  },
  // Google Slides actions
  {
    type: 'function',
    function: {
      name: 'create_google_presentation',
      description: 'Create a new Google Slides presentation.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Presentation title' },
        },
        required: ['title'],
      },
    },
  },
  // ============================================================
  // TIER 3: Drive / Docs / Sheets / Slides Pro — additive
  // ============================================================
  // ── Drive Pro
  { type: 'function', function: { name: 'drive_list_files', description: 'List files in Google Drive with optional Drive query.', parameters: { type: 'object', properties: { q: { type: 'string', description: "Drive query, e.g. \"name contains 'invoice' and trashed=false\"" }, pageSize: { type: 'number' }, pageToken: { type: 'string' } } } } },
  { type: 'function', function: { name: 'drive_get_file', description: 'Get metadata for a Drive file by ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'drive_create_folder', description: 'Create a folder in Google Drive (optionally inside a parent folder).', parameters: { type: 'object', properties: { name: { type: 'string' }, parents: { type: 'array', items: { type: 'string' } } }, required: ['name'] } } },
  { type: 'function', function: { name: 'drive_move_file', description: 'Move a Drive file to a different folder.', parameters: { type: 'object', properties: { id: { type: 'string' }, newParentId: { type: 'string' } }, required: ['id', 'newParentId'] } } },
  { type: 'function', function: { name: 'drive_copy_file', description: 'Copy a Drive file (optionally rename the copy).', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'drive_rename_file', description: 'Rename a Drive file.', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'] } } },
  { type: 'function', function: { name: 'drive_trash_file', description: 'Move a Drive file to trash. Confirm with user first.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'drive_untrash_file', description: 'Restore a Drive file from trash.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'drive_share_file', description: 'Share a Drive file with a person or group (sets a permission).', parameters: { type: 'object', properties: { id: { type: 'string' }, emailAddress: { type: 'string' }, role: { type: 'string', enum: ['reader', 'commenter', 'writer', 'owner'] }, type: { type: 'string', enum: ['user', 'group', 'domain', 'anyone'] } }, required: ['id'] } } },
  { type: 'function', function: { name: 'drive_list_permissions', description: 'List all sharing permissions on a Drive file.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'drive_remove_permission', description: 'Remove a sharing permission from a Drive file.', parameters: { type: 'object', properties: { fileId: { type: 'string' }, permissionId: { type: 'string' } }, required: ['fileId', 'permissionId'] } } },
  { type: 'function', function: { name: 'drive_storage_quota', description: "Get the user's Google Drive storage quota and usage.", parameters: { type: 'object', properties: {} } } },

  // ── Docs Pro
  { type: 'function', function: { name: 'docs_list_documents', description: 'List Google Docs documents.', parameters: { type: 'object', properties: { pageSize: { type: 'number' } } } } },
  { type: 'function', function: { name: 'docs_get_document', description: 'Get the full structure/contents of a Google Doc.', parameters: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] } } },
  { type: 'function', function: { name: 'docs_insert_text', description: 'Insert text into a Google Doc at a given index (default 1 = start).', parameters: { type: 'object', properties: { documentId: { type: 'string' }, text: { type: 'string' }, index: { type: 'number' } }, required: ['documentId', 'text'] } } },
  { type: 'function', function: { name: 'docs_replace_text', description: 'Find and replace all matches of a string in a Google Doc.', parameters: { type: 'object', properties: { documentId: { type: 'string' }, find: { type: 'string' }, replaceText: { type: 'string' } }, required: ['documentId', 'find', 'replaceText'] } } },
  { type: 'function', function: { name: 'docs_batch_update', description: 'Run an arbitrary Google Docs batchUpdate request payload (advanced; pass requests array).', parameters: { type: 'object', properties: { documentId: { type: 'string' }, requests: { type: 'array', items: { type: 'object' } } }, required: ['documentId', 'requests'] } } },
  { type: 'function', function: { name: 'docs_apply_markdown', description: 'Apply markdown content (headings, bold, italic, code, bullet & numbered lists) to a Google Doc with full styling in ONE call. Use this for creating styled docs or restyling existing ones — preferred over docs_batch_update for content. Set replaceAll=true to wipe existing body first.', parameters: { type: 'object', properties: { documentId: { type: 'string' }, markdown: { type: 'string', description: 'Markdown body. Supports # / ## / ### headings, **bold**, *italic*, `code`, - / * bullets, 1. numbered lists.' }, replaceAll: { type: 'boolean', description: 'If true, deletes existing body content before inserting. Default false (appends).' } }, required: ['documentId', 'markdown'] } } },
  { type: 'function', function: { name: 'docs_format_as_report', description: 'One-shot: apply a clean professional report theme to an existing Google Doc (Arial 11pt body, 1.15 line spacing, first paragraph promoted to Heading 1 / 24pt bold). Use when the user says "make this look nice/professional/clean".', parameters: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] } } },
  { type: 'function', function: { name: 'docs_style_range', description: 'Apply character styling (bold/italic/fontSize/color/link) to a specific text range in a Google Doc. Use for surgical edits.', parameters: { type: 'object', properties: { documentId: { type: 'string' }, startIndex: { type: 'number' }, endIndex: { type: 'number' }, bold: { type: 'boolean' }, italic: { type: 'boolean' }, fontSize: { type: 'number', description: 'Point size, e.g. 14' }, foregroundColor: { type: 'string', description: 'Hex color "#RRGGBB"' }, link: { type: 'string', description: 'URL to make the range a hyperlink' } }, required: ['documentId', 'startIndex', 'endIndex'] } } },
  { type: 'function', function: { name: 'docs_clear_formatting', description: 'Strip all character + paragraph formatting (and bullets) on a range in a Google Doc. Omit indices to clear the whole body. Useful before re-styling.', parameters: { type: 'object', properties: { documentId: { type: 'string' }, startIndex: { type: 'number' }, endIndex: { type: 'number' } }, required: ['documentId'] } } },

  // ── Sheets Pro
  { type: 'function', function: { name: 'sheets_list_spreadsheets', description: 'List Google Sheets spreadsheets.', parameters: { type: 'object', properties: { pageSize: { type: 'number' } } } } },
  { type: 'function', function: { name: 'sheets_get_spreadsheet', description: 'Get spreadsheet metadata (sheets, properties).', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' } }, required: ['spreadsheetId'] } } },
  { type: 'function', function: { name: 'sheets_read_range', description: 'Read values from a sheet range (e.g. "Sheet1!A1:D10").', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' }, valueRenderOption: { type: 'string', enum: ['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'] } }, required: ['spreadsheetId', 'range'] } } },
  { type: 'function', function: { name: 'sheets_write_range', description: 'Write values into a sheet range (overwrites).', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' }, values: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Array of rows, each row is an array of cell values (strings)' }, valueInputOption: { type: 'string', enum: ['RAW', 'USER_ENTERED'] } }, required: ['spreadsheetId', 'range', 'values'] } } },
  { type: 'function', function: { name: 'sheets_append_rows', description: 'Append rows to the bottom of a range.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' }, values: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Array of rows, each row is an array of cell values (strings)' } }, required: ['spreadsheetId', 'range', 'values'] } } },
  { type: 'function', function: { name: 'sheets_clear_range', description: 'Clear all values from a range (preserves formatting).', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' } }, required: ['spreadsheetId', 'range'] } } },
  { type: 'function', function: { name: 'sheets_create_spreadsheet', description: 'Create a new Google Sheets spreadsheet.', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'sheets_add_sheet', description: 'Add a new tab/sheet to an existing spreadsheet.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, title: { type: 'string' } }, required: ['spreadsheetId', 'title'] } } },
  { type: 'function', function: { name: 'sheets_delete_sheet', description: 'Delete a tab/sheet by sheetId (numeric).', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, sheetId: { type: 'number' } }, required: ['spreadsheetId', 'sheetId'] } } },
  { type: 'function', function: { name: 'sheets_get_values_batch', description: 'Read values from multiple ranges in one call.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, ranges: { type: 'array', items: { type: 'string' } } }, required: ['spreadsheetId', 'ranges'] } } },
  { type: 'function', function: { name: 'sheets_batch_update', description: 'Run an arbitrary Sheets batchUpdate (advanced; format, sort, charts, etc.).', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, requests: { type: 'array', items: { type: 'object' } } }, required: ['spreadsheetId', 'requests'] } } },

  // ── Slides Pro
  { type: 'function', function: { name: 'slides_list_presentations', description: 'List Google Slides presentations.', parameters: { type: 'object', properties: { pageSize: { type: 'number' } } } } },
  { type: 'function', function: { name: 'slides_get_presentation', description: 'Get the full structure of a Google Slides presentation.', parameters: { type: 'object', properties: { presentationId: { type: 'string' } }, required: ['presentationId'] } } },
  { type: 'function', function: { name: 'slides_add_slide', description: 'Add a new slide to a presentation. Layout defaults to BLANK.', parameters: { type: 'object', properties: { presentationId: { type: 'string' }, layout: { type: 'string', description: 'TITLE, TITLE_AND_BODY, BLANK, etc.' }, insertionIndex: { type: 'number' } }, required: ['presentationId'] } } },
  { type: 'function', function: { name: 'slides_delete_slide', description: 'Delete a slide by its objectId.', parameters: { type: 'object', properties: { presentationId: { type: 'string' }, objectId: { type: 'string' } }, required: ['presentationId', 'objectId'] } } },
  { type: 'function', function: { name: 'slides_replace_text', description: 'Find and replace text across all slides in a presentation.', parameters: { type: 'object', properties: { presentationId: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, matchCase: { type: 'boolean' } }, required: ['presentationId', 'find', 'replace'] } } },
  { type: 'function', function: { name: 'slides_batch_update', description: 'Run an arbitrary Slides batchUpdate (advanced; insert text, images, shapes).', parameters: { type: 'object', properties: { presentationId: { type: 'string' }, requests: { type: 'array', items: { type: 'object' } } }, required: ['presentationId', 'requests'] } } },
  { type: 'function', function: { name: 'slides_get_thumbnail', description: 'Get a thumbnail image URL for a single slide.', parameters: { type: 'object', properties: { presentationId: { type: 'string' }, pageObjectId: { type: 'string' }, mimeType: { type: 'string' }, thumbnailSize: { type: 'string', enum: ['SMALL', 'MEDIUM', 'LARGE'] } }, required: ['presentationId', 'pageObjectId'] } } },
  // ClickUp tools migrated to manifest registry (_shared/integrations/clickup.ts)
  // ============ GoHighLevel actions ============
  {
    type: 'function',
    function: {
      name: 'ghl_list_contacts',
      description: 'List or search contacts in GoHighLevel CRM. Use when the user asks about their GHL contacts, leads, or CRM data.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to filter contacts by name, email, or phone (optional)' },
          limit: { type: 'number', description: 'Max contacts to return (default 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_contact',
      description: 'Create a new contact/lead in GoHighLevel CRM.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string', description: 'First name' },
          lastName: { type: 'string', description: 'Last name' },
          email: { type: 'string', description: 'Email address' },
          phone: { type: 'string', description: 'Phone number (optional)' },
          tags: { type: 'string', description: 'Comma-separated tags (optional)' },
          source: { type: 'string', description: 'Lead source (optional)' },
        },
        required: ['firstName', 'lastName', 'email'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_opportunity',
      description: 'Create a new opportunity/deal in a GoHighLevel pipeline.',
      parameters: {
        type: 'object',
        properties: {
          pipeline_id: { type: 'string', description: 'Pipeline ID to add the opportunity to' },
          stage_id: { type: 'string', description: 'Stage ID within the pipeline' },
          name: { type: 'string', description: 'Opportunity name' },
          contact_id: { type: 'string', description: 'Contact ID to associate with' },
          monetary_value: { type: 'number', description: 'Deal value in dollars (optional)' },
          status: { type: 'string', description: 'Status: open, won, lost, abandoned (default: open)' },
        },
        required: ['pipeline_id', 'stage_id', 'name', 'contact_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_opportunities',
      description: 'List opportunities/deals in a GoHighLevel pipeline.',
      parameters: {
        type: 'object',
        properties: {
          pipeline_id: { type: 'string', description: 'Pipeline ID to list opportunities from' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['pipeline_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_pipelines',
      description: 'List all pipelines and their stages in GoHighLevel. Use this first to discover pipeline and stage IDs.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_send_message',
      description: 'Send an SMS or email message to a contact via GoHighLevel conversations.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string', description: 'Contact ID to message' },
          message: { type: 'string', description: 'Message text' },
          type: { type: 'string', description: 'Message type: SMS, Email, WhatsApp (default: SMS)' },
          subject: { type: 'string', description: 'Email subject (required for Email type)' },
        },
        required: ['contact_id', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_calendars',
      description: 'List all calendars in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_book_appointment',
      description: 'Book an appointment on a GoHighLevel calendar for a contact.',
      parameters: {
        type: 'object',
        properties: {
          calendar_id: { type: 'string', description: 'Calendar ID' },
          contact_id: { type: 'string', description: 'Contact ID' },
          start_time: { type: 'string', description: 'Start time ISO 8601' },
          end_time: { type: 'string', description: 'End time ISO 8601' },
          title: { type: 'string', description: 'Appointment title (optional)' },
        },
        required: ['calendar_id', 'contact_id', 'start_time', 'end_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_add_tags',
      description: 'Add tags to a contact in GoHighLevel.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string', description: 'Contact ID' },
          tags: { type: 'string', description: 'Comma-separated tags to add' },
        },
        required: ['contact_id', 'tags'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_workflows',
      description: 'List all workflows in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_campaigns',
      description: 'List all campaigns in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  // ============ Tier 1: Expose existing proxy capabilities as AI tools ============
  {
    type: 'function',
    function: {
      name: 'ghl_get_contact',
      description: 'Get full details for a specific GoHighLevel contact by ID.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID' } }, required: ['contact_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_contact',
      description: 'Update fields on a GoHighLevel contact (name, email, phone, tags, custom fields).',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID' }, firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, tags: { type: 'string', description: 'Comma-separated tags to set' }, customFields: { type: 'string', description: 'JSON string of custom field key-value pairs' } }, required: ['contact_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_search_contacts',
      description: 'Advanced search for contacts in GoHighLevel using filters (POST-based search).',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, filters: { type: 'string', description: 'JSON string of filter criteria (optional)' }, limit: { type: 'number', description: 'Max results (default 20)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_opportunity',
      description: 'Update a GoHighLevel opportunity (move stage, update value, change status).',
      parameters: { type: 'object', properties: { opportunity_id: { type: 'string', description: 'Opportunity ID' }, stage_id: { type: 'string', description: 'New stage ID' }, monetary_value: { type: 'number', description: 'Updated deal value' }, status: { type: 'string', description: 'Status: open, won, lost, abandoned' }, name: { type: 'string', description: 'Updated name' } }, required: ['opportunity_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_calendar_events',
      description: 'View upcoming appointments/events on a GoHighLevel calendar.',
      parameters: { type: 'object', properties: { calendar_id: { type: 'string', description: 'Calendar ID' }, start_time: { type: 'string', description: 'Start time ISO 8601 (default: now)' }, end_time: { type: 'string', description: 'End time ISO 8601 (default: 7 days from now)' } }, required: ['calendar_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_free_slots',
      description: 'Check available free slots on a GoHighLevel calendar.',
      parameters: { type: 'object', properties: { calendar_id: { type: 'string', description: 'Calendar ID' }, start_date: { type: 'string', description: 'Start date YYYY-MM-DD (default: today)' }, end_date: { type: 'string', description: 'End date YYYY-MM-DD (default: 7 days out)' } }, required: ['calendar_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_conversations',
      description: 'List recent conversations/message threads in GoHighLevel.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 20)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_conversation_messages',
      description: 'Read messages in a GoHighLevel conversation thread.',
      parameters: { type: 'object', properties: { conversation_id: { type: 'string', description: 'Conversation ID' } }, required: ['conversation_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_invoices',
      description: 'List invoices in GoHighLevel.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 20)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_invoice',
      description: 'Create a new invoice in GoHighLevel.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'Invoice name/title' }, contact_id: { type: 'string', description: 'Contact ID to bill' }, items: { type: 'string', description: 'JSON array of line items [{name, amount, qty}]' } }, required: ['name', 'contact_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_orders',
      description: 'List payment orders in GoHighLevel.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 20)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_transactions',
      description: 'List payment transactions in GoHighLevel.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 20)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_forms',
      description: 'List all forms in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_form_submissions',
      description: 'Get submissions/responses for a GoHighLevel form.',
      parameters: { type: 'object', properties: { form_id: { type: 'string', description: 'Form ID' }, limit: { type: 'number', description: 'Max results (default 20)' } }, required: ['form_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_funnels',
      description: 'List all funnels in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_custom_fields',
      description: 'List all custom fields in GoHighLevel CRM.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_custom_values',
      description: 'List all custom values in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_users',
      description: 'List all team members/users in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_tags',
      description: 'List all available tags in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  // ============ Tier 2: New GHL capabilities ============
  {
    type: 'function',
    function: {
      name: 'ghl_delete_contact',
      description: 'Delete a contact from GoHighLevel CRM.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID to delete' } }, required: ['contact_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_add_contact_note',
      description: 'Add a note to a GoHighLevel contact.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID' }, body: { type: 'string', description: 'Note content' } }, required: ['contact_id', 'body'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_contact_notes',
      description: 'List notes for a GoHighLevel contact.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID' } }, required: ['contact_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_add_contact_task',
      description: 'Add a task/to-do for a GoHighLevel contact.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID' }, title: { type: 'string', description: 'Task title' }, body: { type: 'string', description: 'Task description (optional)' }, dueDate: { type: 'string', description: 'Due date ISO 8601 (optional)' } }, required: ['contact_id', 'title'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_contact_tasks',
      description: 'List tasks for a GoHighLevel contact.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID' } }, required: ['contact_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_remove_tags',
      description: 'Remove tags from a GoHighLevel contact.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID' }, tags: { type: 'string', description: 'Comma-separated tags to remove' } }, required: ['contact_id', 'tags'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_cancel_appointment',
      description: 'Cancel/delete an appointment in GoHighLevel.',
      parameters: { type: 'object', properties: { event_id: { type: 'string', description: 'Appointment/event ID' } }, required: ['event_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_appointment',
      description: 'Update/reschedule an existing GoHighLevel appointment. Use to change the time, title, status, address, or assigned user of an appointment. Only include fields you want to change.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Appointment/event ID to update' },
          start_time: { type: 'string', description: 'New start time ISO 8601 (optional)' },
          end_time: { type: 'string', description: 'New end time ISO 8601 (optional)' },
          title: { type: 'string', description: 'New appointment title (optional)' },
          appointment_status: { type: 'string', description: 'New status: confirmed, cancelled, showed, noshow, invalid (optional)' },
          address: { type: 'string', description: 'New address/location (optional)' },
          assigned_user_id: { type: 'string', description: 'New assigned user ID (optional)' },
          calendar_id: { type: 'string', description: 'Move to a different calendar (optional)' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_trigger_workflow',
      description: 'Trigger a workflow for a specific contact in GoHighLevel.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string', description: 'Contact ID' }, workflow_id: { type: 'string', description: 'Workflow ID' } }, required: ['contact_id', 'workflow_id'] },
    },
  },
  // ============ Tier 3: Social, Products, Courses, Surveys, Blogs, Media, Companies, Links, Businesses ============
  {
    type: 'function',
    function: {
      name: 'ghl_list_social_accounts',
      description: 'List connected social media accounts in GoHighLevel Social Planner.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_social_posts',
      description: 'List social media posts in GoHighLevel Social Planner. Optional filters: type (all|scheduled|posted|failed|in_review), account_ids (comma-separated from ghl_list_social_accounts), limit, skip.',
      parameters: { type: 'object', properties: { type: { type: 'string', description: 'all|scheduled|posted|failed|in_review (default all)' }, account_ids: { type: 'string', description: 'Comma-separated social account IDs' }, limit: { type: 'number' }, skip: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_social_post',
      description: 'Create and schedule a social media post in GoHighLevel.',
      parameters: { type: 'object', properties: { post_text: { type: 'string', description: 'Post text/caption' }, account_ids: { type: 'string', description: 'Comma-separated social account IDs to post to' }, scheduled_at: { type: 'string', description: 'Schedule time ISO 8601 (optional, publishes immediately if omitted)' }, media_urls: { type: 'string', description: 'Comma-separated media URLs (optional)' } }, required: ['post_text', 'account_ids'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_social_post',
      description: 'Delete a social media post from GoHighLevel Social Planner.',
      parameters: { type: 'object', properties: { post_id: { type: 'string', description: 'Post ID to delete' } }, required: ['post_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_products',
      description: 'List products in GoHighLevel store.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 20)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_product',
      description: 'Get details for a specific product in GoHighLevel.',
      parameters: { type: 'object', properties: { product_id: { type: 'string', description: 'Product ID' } }, required: ['product_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_product',
      description: 'Create a new product in GoHighLevel.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'Product name' }, description: { type: 'string', description: 'Product description' }, price: { type: 'number', description: 'Price in cents' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_product',
      description: 'Update a product in GoHighLevel.',
      parameters: { type: 'object', properties: { product_id: { type: 'string', description: 'Product ID' }, name: { type: 'string' }, description: { type: 'string' }, price: { type: 'number', description: 'Price in cents' } }, required: ['product_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_product',
      description: 'Delete a product from GoHighLevel.',
      parameters: { type: 'object', properties: { product_id: { type: 'string', description: 'Product ID' } }, required: ['product_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_courses',
      description: 'List courses/memberships in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_surveys',
      description: 'List surveys in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_survey_submissions',
      description: 'Get submissions for a GoHighLevel survey.',
      parameters: { type: 'object', properties: { survey_id: { type: 'string', description: 'Survey ID' }, limit: { type: 'number', description: 'Max results (default 20)' } }, required: ['survey_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_blog_sites',
      description: 'List blog sites for the GoHighLevel location. Returns blog IDs needed by ghl_list_blog_posts and ghl_create_blog_post. Always call this first when working with blogs.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 20)' }, skip: { type: 'number', description: 'Offset' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_blog_posts',
      description: 'List blog posts for a specific blog site in GoHighLevel. Requires blog_id from ghl_list_blog_sites.',
      parameters: { type: 'object', properties: { blog_id: { type: 'string', description: 'Blog site ID from ghl_list_blog_sites' }, limit: { type: 'number', description: 'Max results (default 20)' }, offset: { type: 'number' } }, required: ['blog_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_blog_post',
      description: 'Get a specific blog post from GoHighLevel.',
      parameters: { type: 'object', properties: { post_id: { type: 'string', description: 'Blog post ID' } }, required: ['post_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_blog_post',
      description: 'Create a new blog post in GoHighLevel under a specific blog site. Requires blog_id from ghl_list_blog_sites.',
      parameters: { type: 'object', properties: { blog_id: { type: 'string', description: 'Blog site ID from ghl_list_blog_sites' }, title: { type: 'string' }, content: { type: 'string', description: 'Blog post HTML body' }, status: { type: 'string', description: 'DRAFT | PUBLISHED | SCHEDULED | ARCHIVED (default DRAFT)' }, url_slug: { type: 'string' }, description: { type: 'string', description: 'SEO meta description' }, image_url: { type: 'string' }, author: { type: 'string' }, categories: { type: 'string', description: 'Comma-separated category IDs' }, tags: { type: 'string', description: 'Comma-separated tags' }, published_at: { type: 'string', description: 'ISO timestamp for SCHEDULED status' } }, required: ['blog_id', 'title', 'content'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_blog_post',
      description: 'Update an existing blog post in GoHighLevel. Requires post_id and blog_id. Only include fields you want to change.',
      parameters: { type: 'object', properties: { post_id: { type: 'string', description: 'Blog post ID' }, blog_id: { type: 'string', description: 'Blog site ID this post belongs to' }, title: { type: 'string' }, content: { type: 'string', description: 'Updated HTML body' }, status: { type: 'string', description: 'DRAFT | PUBLISHED | SCHEDULED | ARCHIVED' }, url_slug: { type: 'string' }, description: { type: 'string', description: 'SEO meta description' }, image_url: { type: 'string' }, author: { type: 'string' }, categories: { type: 'string', description: 'Comma-separated category IDs' }, tags: { type: 'string', description: 'Comma-separated tags' }, published_at: { type: 'string', description: 'ISO timestamp for SCHEDULED status' } }, required: ['post_id', 'blog_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_blog_post',
      description: 'Delete a blog post in GoHighLevel by post_id.',
      parameters: { type: 'object', properties: { post_id: { type: 'string', description: 'Blog post ID' } }, required: ['post_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_media_files',
      description: 'List files in GoHighLevel media library.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 50)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_upload_media_file',
      description: 'Upload a file to the GoHighLevel media library by URL. Provide a public file_url (image, video, doc) and optional file_name.',
      parameters: { type: 'object', properties: { file_url: { type: 'string', description: 'Public URL of the file to upload' }, file_name: { type: 'string', description: 'Desired file name (with extension)' }, parent_id: { type: 'string', description: 'Optional folder/parent ID' } }, required: ['file_url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_companies',
      description: 'List companies in GoHighLevel.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 20)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_company',
      description: 'Get details for a specific company in GoHighLevel.',
      parameters: { type: 'object', properties: { company_id: { type: 'string', description: 'Company ID' } }, required: ['company_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_links',
      description: 'List tracking/trigger links in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_link',
      description: 'Create a tracking/trigger link in GoHighLevel.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'Link name' }, redirectTo: { type: 'string', description: 'Redirect URL' } }, required: ['name', 'redirectTo'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_businesses',
      description: 'List businesses in GoHighLevel.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
     function: {
      name: 'ghl_get_business',
      description: 'Get details for a specific business in GoHighLevel.',
      parameters: { type: 'object', properties: { business_id: { type: 'string', description: 'Business ID' } }, required: ['business_id'] },
    },
  },
  // ============ Edit 1: Previously-unexposed GHL endpoints ============
  {
    type: 'function',
    function: {
      name: 'ghl_get_conversation',
      description: 'Fetch a single GoHighLevel conversation thread by ID.',
      parameters: { type: 'object', properties: { conversation_id: { type: 'string' } }, required: ['conversation_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_invoice',
      description: 'Fetch a single GoHighLevel invoice by ID.',
      parameters: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_opportunity',
      description: 'Fetch a single GoHighLevel opportunity by ID.',
      parameters: { type: 'object', properties: { opportunity_id: { type: 'string' } }, required: ['opportunity_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_social_post',
      description: 'Fetch a single scheduled GoHighLevel social media post.',
      parameters: { type: 'object', properties: { post_id: { type: 'string' } }, required: ['post_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_edit_social_post',
      description: 'Edit a scheduled GoHighLevel social post (text, schedule, media).',
      parameters: { type: 'object', properties: { post_id: { type: 'string' }, summary: { type: 'string' }, scheduled_at: { type: 'string' }, media_urls: { type: 'string', description: 'Comma-separated media URLs' } }, required: ['post_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_link',
      description: 'Update an existing GoHighLevel tracking/short link.',
      parameters: { type: 'object', properties: { link_id: { type: 'string' }, name: { type: 'string' }, redirectTo: { type: 'string' } }, required: ['link_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_import_courses',
      description: 'Bulk import courses into GoHighLevel.',
      parameters: { type: 'object', properties: { payload: { type: 'object', description: 'Course import payload' } }, required: ['payload'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_appointment',
      description: 'Create a raw GoHighLevel calendar appointment (lower-level than ghl_book_appointment).',
      parameters: { type: 'object', properties: { calendar_id: { type: 'string' }, contact_id: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, title: { type: 'string' } }, required: ['calendar_id', 'contact_id', 'start_time'] },
    },
  },
  // ============ Tier A: New GHL endpoints ============
  {
    type: 'function',
    function: {
      name: 'ghl_delete_opportunity',
      description: 'Delete a GoHighLevel opportunity by ID.',
      parameters: { type: 'object', properties: { opportunity_id: { type: 'string' } }, required: ['opportunity_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_opportunity_status',
      description: 'Update a GoHighLevel opportunity status (open, won, lost, abandoned).',
      parameters: { type: 'object', properties: { opportunity_id: { type: 'string' }, status: { type: 'string', enum: ['open', 'won', 'lost', 'abandoned'] } }, required: ['opportunity_id', 'status'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_contact_note',
      description: 'Update a contact note in GoHighLevel.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string' }, note_id: { type: 'string' }, body: { type: 'string' } }, required: ['contact_id', 'note_id', 'body'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_contact_note',
      description: 'Delete a contact note in GoHighLevel.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string' }, note_id: { type: 'string' } }, required: ['contact_id', 'note_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_contact_task',
      description: 'Update a contact task in GoHighLevel (title, body, due date, completion status).',
      parameters: { type: 'object', properties: { contact_id: { type: 'string' }, task_id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, dueDate: { type: 'string' }, completed: { type: 'boolean' } }, required: ['contact_id', 'task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_complete_contact_task',
      description: 'Mark a GoHighLevel contact task as completed.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string' }, task_id: { type: 'string' } }, required: ['contact_id', 'task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_contact_task',
      description: 'Delete a contact task in GoHighLevel.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string' }, task_id: { type: 'string' } }, required: ['contact_id', 'task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_remove_from_workflow',
      description: 'Remove a contact from a GoHighLevel workflow.',
      parameters: { type: 'object', properties: { contact_id: { type: 'string' }, workflow_id: { type: 'string' } }, required: ['contact_id', 'workflow_id'] },
    },
  },
  // ============ Tier B: Custom fields, custom values, tags, calendar groups, users ============
  {
    type: 'function',
    function: {
      name: 'ghl_create_custom_field',
      description: 'Create a custom field in GoHighLevel for the location. For SINGLE_OPTIONS, MULTIPLE_OPTIONS, RADIO, or CHECKBOX dataTypes, you MUST provide an `options` array of strings (or {label,value} objects).',
      parameters: { type: 'object', properties: { name: { type: 'string' }, dataType: { type: 'string', description: 'TEXT, NUMERICAL, PHONE, MONETARY, CHECKBOX, SINGLE_OPTIONS, MULTIPLE_OPTIONS, DATE, TEXTAREA, RADIO, FILE_UPLOAD, SIGNATURE' }, position: { type: 'number' }, model: { type: 'string', description: 'contact or opportunity', enum: ['contact', 'opportunity'] }, options: { type: 'array', description: 'Required for dropdown/radio/checkbox types. Array of option strings like ["Atlanta, GA","Austin, TX"] OR objects {label,value}.', items: { oneOf: [{ type: 'string' }, { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } } }] } } }, required: ['name', 'dataType'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_custom_field',
      description: 'Update a custom field in GoHighLevel.',
      parameters: { type: 'object', properties: { field_id: { type: 'string' }, name: { type: 'string' }, position: { type: 'number' } }, required: ['field_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_custom_field',
      description: 'Delete a custom field in GoHighLevel.',
      parameters: { type: 'object', properties: { field_id: { type: 'string' } }, required: ['field_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_custom_value',
      description: 'Create a custom value (mergeable variable) in GoHighLevel.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_custom_value',
      description: 'Update a custom value in GoHighLevel.',
      parameters: { type: 'object', properties: { value_id: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' } }, required: ['value_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_custom_value',
      description: 'Delete a custom value in GoHighLevel.',
      parameters: { type: 'object', properties: { value_id: { type: 'string' } }, required: ['value_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_tag',
      description: 'Create a location-level tag in GoHighLevel.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_tag',
      description: 'Delete a location-level tag in GoHighLevel by tag ID.',
      parameters: { type: 'object', properties: { tag_id: { type: 'string' } }, required: ['tag_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_calendar_groups',
      description: 'List calendar groups in GoHighLevel for the location.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_calendar_resources',
      description: 'List calendar resources (rooms or equipment) in GoHighLevel.',
      parameters: { type: 'object', properties: { resource_type: { type: 'string', enum: ['rooms', 'equipments'], description: 'rooms or equipments' } }, required: ['resource_type'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_block_calendar_slot',
      description: 'Block a time slot on a GoHighLevel calendar.',
      parameters: { type: 'object', properties: { calendar_id: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, title: { type: 'string' } }, required: ['calendar_id', 'start_time', 'end_time'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_user',
      description: 'Get a single GoHighLevel user by ID.',
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_user',
      description: 'Create a new user in GoHighLevel.',
      parameters: { type: 'object', properties: { firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' }, phone: { type: 'string' }, type: { type: 'string', description: 'account or agency' }, role: { type: 'string', description: 'admin or user' } }, required: ['firstName', 'lastName', 'email', 'password'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_user',
      description: 'Update a GoHighLevel user.',
      parameters: { type: 'object', properties: { user_id: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, role: { type: 'string' } }, required: ['user_id'] },
    },
  },
  // ============ Tier C: SaaS/agency, snapshots, payments, prices, media ============
  {
    type: 'function',
    function: {
      name: 'ghl_list_locations',
      description: 'Agency-level: list sub-account locations the user has access to in GoHighLevel.',
      parameters: { type: 'object', properties: { limit: { type: 'number' }, skip: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_location',
      description: 'Get details for a GoHighLevel location (sub-account).',
      parameters: { type: 'object', properties: { location_id: { type: 'string', description: 'Optional. Defaults to the connected location.' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_location',
      description: 'Update settings on a GoHighLevel location (sub-account).',
      parameters: { type: 'object', properties: { location_id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, country: { type: 'string' }, postalCode: { type: 'string' }, website: { type: 'string' }, timezone: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_snapshots',
      description: 'List GoHighLevel snapshots available to the agency/company.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_order',
      description: 'Get a single GoHighLevel payment order by ID.',
      parameters: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_transaction',
      description: 'Get a single GoHighLevel payment transaction by ID.',
      parameters: { type: 'object', properties: { transaction_id: { type: 'string' } }, required: ['transaction_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_subscriptions',
      description: 'List GoHighLevel payment subscriptions for the location.',
      parameters: { type: 'object', properties: { limit: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_get_subscription',
      description: 'Get a single GoHighLevel payment subscription by ID.',
      parameters: { type: 'object', properties: { subscription_id: { type: 'string' } }, required: ['subscription_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_prices',
      description: 'List prices for a GoHighLevel product.',
      parameters: { type: 'object', properties: { product_id: { type: 'string' }, limit: { type: 'number' } }, required: ['product_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_create_price',
      description: 'Create a price for a GoHighLevel product (amount in smallest currency unit, e.g., cents).',
      parameters: { type: 'object', properties: { product_id: { type: 'string' }, name: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string', description: 'ISO currency code, e.g., USD' }, type: { type: 'string', enum: ['one_time', 'recurring'] }, recurringInterval: { type: 'string', enum: ['day', 'week', 'month', 'year'] } }, required: ['product_id', 'name', 'amount', 'currency', 'type'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_update_price',
      description: 'Update a price on a GoHighLevel product.',
      parameters: { type: 'object', properties: { product_id: { type: 'string' }, price_id: { type: 'string' }, name: { type: 'string' }, amount: { type: 'number' } }, required: ['product_id', 'price_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_upload_media_file',
      description: 'Upload a file to the GoHighLevel media library by URL (the GHL endpoint hosted-file mode).',
      parameters: { type: 'object', properties: { hosted: { type: 'boolean', description: 'true if uploading via URL' }, file_url: { type: 'string' }, name: { type: 'string' }, parent_id: { type: 'string', description: 'Optional folder ID' } }, required: ['file_url', 'name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_delete_media_file',
      description: 'Delete a file from the GoHighLevel media library.',
      parameters: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_list_sub_accounts',
      description: 'List all configured GoHighLevel sub-accounts (locations) for the current user. Use this when the user references multiple businesses/clients, or when you need to disambiguate which sub-account to act on.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_set_active_sub_account',
      description: 'Set the active GoHighLevel sub-account for the remainder of this conversation. Pass either the sub-account id (location_id) or its friendly name. Subsequent GHL tool calls without an explicit location_id will use this one.',
      parameters: {
        type: 'object',
        properties: {
          location_id: { type: 'string', description: 'GHL location/sub-account id' },
          name: { type: 'string', description: 'Friendly name of the sub-account (fuzzy match)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_set_default_sub_account',
      description: 'Set the user\'s PERMANENT default GoHighLevel sub-account. This persists across all future chat sessions — use when the user says things like "make this my default", "remember this account", or "always use X". For temporary single-conversation switches, use ghl_set_active_sub_account instead.',
      parameters: {
        type: 'object',
        properties: {
          location_id: { type: 'string', description: 'GHL location/sub-account id' },
          name: { type: 'string', description: 'Friendly name of the sub-account (fuzzy match)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_check_capability',
      description: 'Check whether the active (or specified) GoHighLevel sub-account has the OAuth scopes required to run a given GHL tool. Call this BEFORE attempting a write (create_custom_field, create_opportunity, send_message, etc.) when you are unsure the account has permission. Returns { allowed, missing_scopes, stored_scopes_count, recommendation }.',
      parameters: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', description: 'The ghl_* tool to check, e.g. "ghl_create_custom_field".' },
          location_id: { type: 'string', description: 'Optional sub-account id. Defaults to the active account.' },
        },
        required: ['tool_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ghl_smart_search',
      description: 'Unified search across GoHighLevel contacts, opportunities, conversations, and appointments in a single call. Use this when the user asks to "find" or "search for" something in GHL without specifying the resource type — it collapses what would otherwise be 3-4 separate tool calls.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search term (name, email, phone, deal name, etc.)' },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['contacts', 'opportunities', 'conversations', 'appointments'] },
            description: 'Resource types to search. Defaults to all four.',
          },
          limit: { type: 'number', description: 'Max results per type (default 5)' },
          location_id: { type: 'string', description: 'Optional sub-account override' },
        },
        required: ['query'],
      },
    },
  },
  // ============ GSC / SEO Intelligence Tools ============
  {
    type: 'function',
    function: {
      name: 'gsc_list_sites',
      description: 'List all verified Google Search Console properties with their permission levels. Use this to discover which sites the user has access to.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gsc_query',
      description: 'Run a full Search Analytics query on a Google Search Console property. Supports custom date ranges, dimensions (query, page, country, device, date, searchAppearance), filters, and row limits up to 1000. Use for deep SEO analysis, keyword research, page performance, trend analysis, and comparative reports.',
      parameters: {
        type: 'object',
        properties: {
          site_url: { type: 'string', description: 'GSC property URL (e.g. "sc-domain:ozlon.net" or "https://example.com/")' },
          start_date: { type: 'string', description: 'Start date YYYY-MM-DD' },
          end_date: { type: 'string', description: 'End date YYYY-MM-DD' },
          dimensions: { type: 'string', description: 'Comma-separated dimensions: query, page, country, device, date, searchAppearance (default: query)' },
          row_limit: { type: 'number', description: 'Max rows to return (default 100, max 1000)' },
          filters: { type: 'string', description: 'JSON array of filters e.g. [{"dimension":"query","operator":"contains","expression":"ai"}]. Operators: equals, contains, notEquals, notContains.' },
          aggregation_type: { type: 'string', description: 'auto, byPage, or byProperty (default: auto)' },
        },
        required: ['site_url', 'start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gsc_save_snapshot',
      description: 'Save the current GSC query results as a snapshot for future trend comparison. Call this after running a gsc_query to persist the data. The AI should suggest saving snapshots after significant analyses.',
      parameters: {
        type: 'object',
        properties: {
          site_url: { type: 'string', description: 'GSC property URL' },
          start_date: { type: 'string', description: 'Query start date YYYY-MM-DD' },
          end_date: { type: 'string', description: 'Query end date YYYY-MM-DD' },
          dimensions: { type: 'string', description: 'Comma-separated dimensions used in the query' },
          data: { type: 'string', description: 'JSON string of the query result rows' },
          totals: { type: 'string', description: 'JSON string of aggregate totals {clicks, impressions, ctr, position}' },
        },
        required: ['site_url', 'start_date', 'end_date', 'data'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gsc_compare_snapshots',
      description: 'Load previous SEO snapshots for a site to compare with current data. Shows trend changes over time. Use when the user asks "what changed", "compare to last week/month", or wants to track SEO progress.',
      parameters: {
        type: 'object',
        properties: {
          site_url: { type: 'string', description: 'GSC property URL to find snapshots for' },
          limit: { type: 'number', description: 'Max snapshots to retrieve (default 5)' },
        },
        required: ['site_url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search_google',
      description: 'Perform a live Google search for a keyword to see current SERP results. Use to cross-reference GSC ranking data with actual live search positions, identify competitors, and validate ranking claims. Returns top 10 organic results.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Search query/keyword to look up on Google' },
          num_results: { type: 'number', description: 'Number of results to return (default 10, max 20)' },
        },
        required: ['keyword'],
      },
    },
  },
  // ============ Image Generation / Editing (Gemini Nano Banana) ============
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate a brand-new image from a text prompt using Gemini image models (Nano Banana family). Use when the user asks for an illustration, mockup, diagram, logo, or visual concept. Returns a public URL to the generated image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed visual description of the image to generate.' },
          model: { type: 'string', description: 'Optional model override (e.g. google/gemini-3-pro-image-preview for higher quality).' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_image',
      description: 'Edit an existing image based on a text instruction (e.g. "make the sky purple", "remove the background", "add a hat"). Requires both the source image URL and the editing instruction. Returns a public URL to the edited image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Editing instruction.' },
          image_url: { type: 'string', description: 'URL of the image to edit (https or data URL).' },
        },
        required: ['prompt', 'image_url'],
      },
    },
  },
  // ============ Video Generation (Veo 3 / Higgsfield fallback) ============
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description: 'Generate a short AI video from a text prompt using Veo 3 (Google) with automatic fallback to Higgsfield AI if the user has it connected. Use when the user asks to create, generate, or make a video clip. Returns a public URL to the generated video (or a request_id when Higgsfield is used asynchronously).',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the video to generate.' },
          duration: { type: 'number', description: 'Video length in seconds — 5 or 10 (default 5).' },
          aspect_ratio: { type: 'string', description: 'Aspect ratio: 16:9, 9:16, or 1:1 (default 16:9).' },
        },
        required: ['prompt'],
      },
    },
  },
  // ============ Memory / Learning Tool ============
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save a durable memory about the user — a preference, correction, workflow pattern, fact, goal, or value. Call this whenever the user states a reusable preference (e.g. "always convert Drive links"), corrects you, reveals a personal fact, or establishes a workflow pattern. This persists across all future conversations.',
      parameters: {
        type: 'object',
        properties: {
          memory_type: { type: 'string', description: 'One of: fact, preference, pattern, context, goal, value', enum: ['fact', 'preference', 'pattern', 'context', 'goal', 'value'] },
          content: { type: 'string', description: 'The memory content (1-3 sentences, specific and actionable)' },
          summary: { type: 'string', description: 'Brief one-line summary for quick reference' },
          salience: { type: 'number', description: 'How important this is to remember, 0.0-1.0 (default 0.6)' },
        },
        required: ['memory_type', 'content', 'summary'],
      },
    },
  },
  // ============ Memory Recall Tool ============
  {
    type: 'function',
    function: {
      name: 'search_wisdom_memories',
      description: 'Semantic search over the user\'s saved wisdom memories (preferences, patterns, facts, goals, values, context). Call this BEFORE acting on a request when prior preferences or patterns might apply — e.g. before routing a marketing skill, before drafting copy in the user\'s voice, before choosing tone or format. Returns the top matches by semantic similarity. Pass memory_type to scope the search when a skill\'s memory_domains list narrows the scope (e.g. "pattern" for routing history, "preference" for tone rules).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query to search for. Be specific to the decision you are making.' },
          memory_type: { type: 'string', description: 'Optional filter. One of: fact, preference, pattern, context, goal, value', enum: ['fact', 'preference', 'pattern', 'context', 'goal', 'value'] },
          limit: { type: 'number', description: 'Max results to return, 1-20 (default 5).' },
        },
        required: ['query'],
      },
    },
  },
  // ============ Scheduled Routines (Recurring Workflows) ============
  {
    type: 'function',
    function: {
      name: 'create_routine',
      description: 'Create a recurring scheduled routine that fires automatically on a cron schedule. Use when the user says "every morning", "daily at 7am", "every Monday", "remind me weekly", etc. The routine prompt will be executed by the assistant with all tools enabled at the scheduled time.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short routine name, e.g. "Morning Brief"' },
          description: { type: 'string', description: 'Optional plain-English description' },
          prompt: { type: 'string', description: 'The full prompt the AI will execute when the routine fires. Be explicit — list every step, source, and output format. Example: "Scan unread Gmail, fetch today\'s Calendar, get top 3 industry headlines via Tavily, summarize into a Doc, email the link to me."' },
          cron_expression: { type: 'string', description: 'Standard 5-field cron expression in UTC. Examples: "0 12 * * *" = 7am EST daily, "0 13 * * 1" = 8am EST Monday, "30 14 * * *" = 9:30am EST daily.' },
          delivery_channel: { type: 'string', enum: ['in_app', 'email', 'gmail', 'doc'], description: 'Where to deliver the result (default in_app).' },
        },
        required: ['name', 'prompt', 'cron_expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_routines',
      description: 'List all the user\'s scheduled routines (active and paused).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_routine',
      description: 'Pause or resume a scheduled routine.',
      parameters: {
        type: 'object',
        properties: {
          routine_id: { type: 'string', description: 'The routine id' },
          active: { type: 'boolean', description: 'true to enable, false to pause' },
        },
        required: ['routine_id', 'active'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_routine',
      description: 'Permanently delete a scheduled routine.',
      parameters: {
        type: 'object',
        properties: { routine_id: { type: 'string' } },
        required: ['routine_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_routine_now',
      description: 'Trigger a routine to run immediately, outside of its schedule.',
      parameters: {
        type: 'object',
        properties: { routine_id: { type: 'string' } },
        required: ['routine_id'],
      },
    },
  },
  // ============ Standing Orders (Durable Rules) ============
  {
    type: 'function',
    function: {
      name: 'add_standing_order',
      description: 'Create a durable RULE the assistant will obey on every future turn (e.g. "always answer in 2 sentences", "never spend over $200 without asking"). Use when the user says "from now on", "always", "never", or sets a durable behavioral rule.',
      parameters: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: 'The rule text (imperative, short)' },
          scope: { type: 'string', description: 'global | finance | email | creative | research', enum: ['global', 'finance', 'email', 'creative', 'research'] },
          priority: { type: 'number', description: '1 (highest) to 10 (lowest); default 5' },
        },
        required: ['rule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_standing_order',
      description: 'Deactivate an existing standing order by id. Use when the user says "stop doing X" or "ignore that rule".',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'The standing order id to deactivate' },
        },
        required: ['order_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_standing_order',
      description: 'REPLACE an existing standing order with a new version. Call this — NOT add_standing_order — when the user phrases a change like "now do X, not Y", "instead of … do …", "change the rule about …", or "actually, from now on …". Performs a fuzzy match against active rules, deactivates the old one (linked via superseded_by), and inserts the new one. Always confirm the replacement in your reply ("Updated: previously \'X\', now \'Y\'.").',
      parameters: {
        type: 'object',
        properties: {
          old_rule_match: { type: 'string', description: 'A short phrase or keyword from the existing rule to find and replace (e.g. "two sentences", "Drive links").' },
          new_rule: { type: 'string', description: 'The new rule text. Pass empty string to simply deactivate the old rule with no replacement.' },
          scope: { type: 'string', description: 'global | finance | email | creative | research', enum: ['global', 'finance', 'email', 'creative', 'research'] },
        },
        required: ['old_rule_match', 'new_rule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_memory',
      description: 'REPLACE an existing saved memory with a new version. Call this — NOT save_memory — when the user changes a previously stated preference, fact, or pattern (e.g. "actually I prefer X, not Y"). Performs a fuzzy match against existing memory summaries/content, supersedes the old one, and inserts the new one. Always confirm the replacement in your reply.',
      parameters: {
        type: 'object',
        properties: {
          old_summary_match: { type: 'string', description: 'A short phrase or keyword from the existing memory to find and replace.' },
          new_content: { type: 'string', description: 'The new memory content (1-3 specific sentences).' },
          memory_type: { type: 'string', description: 'fact | preference | context | pattern | goal | value', enum: ['fact', 'preference', 'context', 'pattern', 'goal', 'value'] },
        },
        required: ['old_summary_match', 'new_content'],
      },
    },
  },
  // ============ User Goals ============
  {
    type: 'function',
    function: {
      name: 'add_goal',
      description: 'Track a goal for the user. Call when the user states an outcome they want over time (e.g. "I want 10 paying users by March").',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short goal title' },
          description: { type: 'string', description: 'Optional detail / context' },
          target_date: { type: 'string', description: 'Optional target date (YYYY-MM-DD)' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_goal_progress',
      description: 'Append a progress note to an existing goal.',
      parameters: {
        type: 'object',
        properties: {
          goal_id: { type: 'string', description: 'Goal id' },
          note: { type: 'string', description: 'Short progress note' },
        },
        required: ['goal_id', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_goal',
      description: 'Mark a goal complete.',
      parameters: {
        type: 'object',
        properties: {
          goal_id: { type: 'string', description: 'Goal id' },
        },
        required: ['goal_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deep_research',
      description: 'Live web research and general web search. Use this for ANY request that needs information from the open internet — news, facts, prices, reviews, "what is", "find me", "search for", "look up", "google", current events, competitor info, local listings, opinions, definitions, or anything beyond your training data. Searches the web (Tavily), reads multiple sources, and returns a cited synthesis. THIS IS YOUR PRIMARY WEB SEARCH TOOL — do NOT invent generic names like "websearch" or "search_web"; always call this one.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The research question or topic to investigate' },
          search_depth: { type: 'string', enum: ['basic', 'advanced'], description: 'Search depth — use advanced for thorough research (default)' },
          max_results: { type: 'number', description: 'Number of sources to retrieve (default 8, max 20)' },
        },
        required: ['query'],
      },
    },
  },
  // ============ Scrape Events Tool ============
  {
    type: 'function',
    function: {
      name: 'scrape_events',
      description: 'Find real upcoming events (networking, conferences, meetups, workshops, webinars, local gatherings) and extract structured event data — title, date, location, URL — then save them for the user. Use whenever the user asks about events, conferences, meetups, networking opportunities, "what\'s happening near me", or upcoming local/industry dates. Combines Tavily web search with Firecrawl page scraping for richer detail.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for events, e.g. "networking events in LA June 2026"' },
          category: { type: 'string', enum: ['networking', 'conference', 'meetup', 'workshop', 'webinar', 'other'], description: 'Event category (default: networking)' },
          max_results: { type: 'number', description: 'Max events to find (default 10, max 20)' },
        },
        required: ['query'],
      },
    },
  },
  // ============ List Events Tool ============
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: 'List the user\'s previously discovered events, optionally filtered by category or date range. Use when the user asks to see their events, upcoming dates, or saved events.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category (networking, conference, meetup, etc.)' },
          from_date: { type: 'string', description: 'Start date filter (ISO format)' },
          to_date: { type: 'string', description: 'End date filter (ISO format)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
  },
  // ============ Work Task Creation Tool ============
  {
    type: 'function',
    function: {
      name: 'create_work_task',
      description: 'Create a new work task in the AI operations workspace. Use when the user asks to create a task, track something, start a project, or when a multi-step work request should be turned into a trackable task.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title — concise and actionable' },
          description: { type: 'string', description: 'Task description with context and requirements' },
          task_type: { type: 'string', enum: ['general', 'email', 'research', 'content', 'outreach', 'ops', 'creative'], description: 'Type of task (default: general)' },
          intent_type: { type: 'string', enum: ['ops', 'lead_gen', 'fulfillment', 'content', 'research', 'outreach', 'admin'], description: 'Business intent (default: ops)' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Priority level (default: medium)' },
          assigned_to: { type: 'string', description: 'Who should handle this (default: ai)' },
          next_action: { type: 'string', enum: ['waiting_on_ai', 'waiting_on_human', 'ready_to_send', 'needs_review', 'blocked', 'none'], description: 'Next action state (default: waiting_on_ai)' },
        },
        required: ['title', 'description'],
      },
    },
  },
  // ============ Work Task Update Tool ============
  {
    type: 'function',
    function: {
      name: 'update_work_task',
      description: 'Update an existing work task status, deliverable, or activity log. Use after completing work to move a task through stages. Always follow the chain: todo → in_progress → up_for_review → completed. Never skip stages.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The work task ID to update' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'up_for_review', 'completed'], description: 'New status — must follow valid transitions' },
          draft_output: { type: 'string', description: 'Markdown deliverable content to save' },
          ai_status: { type: 'string', enum: ['idle', 'thinking', 'executing', 'waiting', 'error'], description: 'Current AI processing status' },
          next_action: { type: 'string', enum: ['waiting_on_ai', 'waiting_on_human', 'ready_to_send', 'needs_review', 'blocked', 'none'], description: 'Next action state' },
          activity_entry: {
            type: 'object',
            description: 'Structured activity log entry to append',
            properties: {
              action: { type: 'string', description: 'Action identifier e.g. research_started, draft_completed' },
              detail: { type: 'string', description: 'Human-readable description of what happened' },
              status: { type: 'string', enum: ['idle', 'thinking', 'executing', 'waiting', 'error', 'completed', 'failed'], description: 'Status of this activity' },
              actor: { type: 'string', description: 'Who performed this — ai or user' },
            },
            required: ['action', 'detail', 'actor'],
            additionalProperties: false,
          },
        },
        required: ['task_id'],
        additionalProperties: false,
      },
    },
  },
  // ============ Bulk Work Task Update Tool ============
  {
    type: 'function',
    function: {
      name: 'bulk_update_work_tasks',
      description: 'Update multiple work tasks in one call. Use this when the user asks to change status on 2+ tasks in the same turn (e.g. "mark A and B completed and cancel C"). Returns per-task succeeded/failed results so partial failures are surfaced clearly.',
      parameters: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            description: 'List of per-task updates. Each item must include task_id and at least one field to change.',
            items: {
              type: 'object',
              properties: {
                task_id: { type: 'string', description: 'The work task ID to update' },
                status: { type: 'string', enum: ['todo', 'in_progress', 'up_for_review', 'completed'] },
                draft_output: { type: 'string' },
                ai_status: { type: 'string', enum: ['idle', 'thinking', 'executing', 'waiting', 'error'] },
                next_action: { type: 'string', enum: ['waiting_on_ai', 'waiting_on_human', 'ready_to_send', 'needs_review', 'blocked', 'none'] },
              },
              required: ['task_id'],
              additionalProperties: false,
            },
            minItems: 1,
          },
        },
        required: ['updates'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'higgsfield_generate_image',
      description: 'Generate an image with Higgsfield AI (Soul models). Returns a request_id — poll with higgsfield_get_job_status. Use this when the user asks to create/generate/make an image, picture, or visual.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed visual description.' },
          model: { type: 'string', description: 'Model ID. Defaults to "higgsfield-ai/soul/standard". Options: "higgsfield-ai/soul/standard", "higgsfield-ai/soul/pro", "higgsfield-ai/soul-id".' },
          aspect_ratio: { type: 'string', description: 'e.g. "16:9", "9:16", "1:1", "4:5". Default "16:9".' },
          resolution: { type: 'string', description: 'e.g. "720p", "1080p". Default "720p".' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'higgsfield_generate_video',
      description: 'Generate a video from a source image using Higgsfield AI (DoP models). Returns a request_id — poll with higgsfield_get_job_status. Use when user asks to animate an image, create video from image, or generate motion.',
      parameters: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'Public URL of the source image.' },
          prompt: { type: 'string', description: 'Optional motion / scene description.' },
          model: { type: 'string', description: 'Model ID. Defaults to "higgsfield-ai/dop/standard". Options: "higgsfield-ai/dop/standard", "higgsfield-ai/dop/pro", "higgsfield-ai/dop/turbo", "higgsfield-ai/dop/lite".' },
          duration: { type: 'number', description: 'Duration in seconds (default 5).' },
        },
        required: ['image_url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'higgsfield_get_job_status',
      description: 'Check the status of a Higgsfield generation job. Returns status (queued/processing/completed/failed) and output URL when done.',
      parameters: {
        type: 'object',
        properties: { request_id: { type: 'string', description: 'Job request ID returned by generate_image / generate_video.' } },
        required: ['request_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'higgsfield_cancel_job',
      description: 'Cancel a queued or running Higgsfield generation job by request_id.',
      parameters: {
        type: 'object',
        properties: { request_id: { type: 'string', description: 'Job request ID to cancel.' } },
        required: ['request_id'],
      },
    },
  },
  // ============ YouTube Upload Tool ============
  {
    type: 'function',
    function: {
      name: 'upload_youtube_video',
      description: [
        'Upload a video to the user\'s YouTube channel via their OAuth connection.',
        'Required: title, video_url. Everything else is optional and should be SUGGESTED, not required.',
        'Rules:',
        '- Preserve user-provided fields verbatim — never rewrite unless explicitly asked.',
        '- Suggest missing SEO fields (tags, hashtags, chapters, category) but never block the upload.',
        '- No keyword stuffing: max 15 tags, total tag length ≤ 500 chars, max 15 hashtags.',
        '- ALWAYS confirm before uploading when privacy_status="public".',
        '- If video is vertical and ≤60s (Shorts), append "#Shorts" to hashtags if not already present.',
        '- chapters[] must include a 00:00 entry; if missing, the system will auto-prepend "00:00 Intro".',
        '- For scheduled publish (publish_at), YT will hold as private until the scheduled time.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Video title (max 100 chars)' },
          description: { type: 'string', description: 'Video description (full body, before chapters/hashtags are appended)' },
          video_url: { type: 'string', description: 'Public URL to video file (mp4/mov/webm). Google Drive share links are auto-resolved via the user\'s OAuth.' },
          privacy_status: { type: 'string', enum: ['private', 'unlisted', 'public'], description: 'Default private unless user specifies.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Max 15 SEO tags.' },
          category_id: { type: 'string', description: 'YouTube category ID (e.g. "22" People & Blogs, "27" Education, "10" Music). Defaults to 22.' },
          made_for_kids: { type: 'boolean', description: 'COPPA self-declaration. Required by YT — defaults to false if not specified.' },
          language: { type: 'string', description: 'BCP-47 language code for the video metadata (e.g. "en", "es").' },
          default_audio_language: { type: 'string', description: 'BCP-47 language code for audio track.' },
          recording_date: { type: 'string', description: 'ISO datetime when the video was recorded.' },
          location: { type: 'string', description: 'Free-text location description.' },
          hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags appended to description (max 15, deduped, "#" optional).' },
          chapters: {
            type: 'array',
            description: 'Timestamped chapters appended to description. Must include 00:00.',
            items: {
              type: 'object',
              properties: {
                timestamp: { type: 'string', description: 'mm:ss or hh:mm:ss' },
                title: { type: 'string' },
              },
              required: ['timestamp', 'title'],
              additionalProperties: false,
            },
          },
          thumbnail_url: { type: 'string', description: 'Public URL to a custom thumbnail (jpg/png, ≤2MB recommended).' },
          captions_url: { type: 'string', description: 'Public URL to an SRT/VTT captions file.' },
          captions_language: { type: 'string', description: 'BCP-47 code for captions (default "en").' },
          playlist_id: { type: 'string', description: 'Add to existing playlist by ID.' },
          playlist_name: { type: 'string', description: 'Add to playlist by name. Created if missing.' },
          publish_at: { type: 'string', description: 'ISO 8601 datetime to schedule publishing. Forces private until that time.' },
          license: { type: 'string', enum: ['youtube', 'creativeCommon'], description: 'Default "youtube".' },
          embeddable: { type: 'boolean' },
          public_stats_viewable: { type: 'boolean' },
          notify_subscribers: { type: 'boolean', description: 'Default true. Set false for silent uploads.' },
        },
        required: ['title', 'video_url'],
      },
    },
  },
  // ============ Search Atlas (SEO intelligence) ============
  {
    type: 'function',
    function: {
      name: 'searchatlas_audit_site',
      description: 'Run a Search Atlas site audit for a domain. Returns crawl issues, on-page SEO scores, and technical health metrics.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Root domain, e.g. "example.com"' } },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchatlas_site_explorer',
      description: 'Search Atlas Site Explorer overview for a domain — estimated traffic, top pages, authority metrics.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Root domain, e.g. "example.com"' } },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchatlas_keyword_research',
      description: 'Search Atlas keyword research — volume, difficulty, CPC, and SERP intent for a seed keyword.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          country: { type: 'string', description: 'ISO country code (default "us")' },
          limit: { type: 'number', description: 'Max related keywords (default 50, max 200)' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchatlas_serp_snapshot',
      description: 'Live SERP snapshot from Search Atlas for a keyword in a given country.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          country: { type: 'string', description: 'ISO country code (default "us")' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchatlas_backlinks_overview',
      description: 'Search Atlas backlinks overview — total backlinks, referring domains, anchor text distribution.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string' } },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchatlas_backlinks_list',
      description: 'Paginated backlink rows from Search Atlas. Filter by type: active, new, or lost.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          type: { type: 'string', enum: ['active', 'new', 'lost'], description: 'Filter (default "active")' },
          limit: { type: 'number', description: 'Max rows (default 50, max 500)' },
        },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchatlas_list_projects',
      description: 'List the user\'s Search Atlas rank-tracking projects so you can pick a projectId for searchatlas_rank_tracker.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchatlas_rank_tracker',
      description: 'Tracked keyword positions for a Search Atlas rank-tracker project.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: 'Search Atlas project ID' } },
        required: ['projectId'],
      },
    },
  },
];
// ============================================================================

// --- State transition validator for work tasks ---
// NOTE: 'cancelled' is intentionally NOT in this map — the work_tasks.status DB CHECK
// constraint only allows {todo, in_progress, up_for_review, completed}. Adding 'cancelled'
// here without a schema migration would surface as a hard 23514 from Postgres.
const VALID_TASK_TRANSITIONS: Record<string, string[]> = {
  todo: ['in_progress', 'up_for_review', 'completed'],
  in_progress: ['todo', 'up_for_review', 'completed'],
  up_for_review: ['todo', 'in_progress', 'completed'],
  completed: ['in_progress', 'up_for_review'],
};



function isValidTaskTransition(from: string, to: string): boolean {
  if (from === to) return true; // no-op is always safe
  return VALID_TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// NATIVE GOOGLE WORKSPACE ROUTER
// Routes Gmail/Drive/Calendar/Sheets/Docs/GSC tool calls to native edge
// functions using the user's own Google OAuth token.
// Returns null on failure so the caller can surface the error.
// ============================================================================

const NATIVE_GOOGLE_ROUTES: Record<string, { fn: string; action: string; mapArgs?: (a: Record<string, unknown>) => Record<string, unknown> }> = {
  // Gmail
  list_emails: { fn: 'google-gmail', action: 'list_messages', mapArgs: (a) => ({ q: a.query, maxResults: a.max_results }) },
  get_email: { fn: 'google-gmail', action: 'get_message', mapArgs: (a) => ({ id: a.message_id }) },
  send_email: { fn: 'google-gmail', action: 'send_message', mapArgs: (a) => ({ to: a.to, subject: a.subject, body: a.body, cc: a.cc }) },
  create_email_draft: { fn: 'google-gmail', action: 'create_draft', mapArgs: (a) => ({ to: a.to, subject: a.subject, body: a.body }) },
  trash_email: { fn: 'google-gmail', action: 'trash_message', mapArgs: (a) => ({ id: a.message_id }) },
  label_email: { fn: 'google-gmail', action: 'modify_message', mapArgs: (a) => ({ id: a.message_id, addLabelIds: a.add_labels, removeLabelIds: a.remove_labels }) },
  mark_email_read: { fn: 'google-gmail', action: 'modify_message', mapArgs: (a) => ({ id: a.message_id, removeLabelIds: ['UNREAD'] }) },
  // Tier 1 Gmail tools migrated to manifest registry — see _shared/integrations/gmail.ts
  // Drive
  search_google_drive: { fn: 'google-drive', action: 'search_files', mapArgs: (a) => ({ name: a.query, pageSize: a.max_results }) },
  // Calendar
  create_calendar_event: { fn: 'google-calendar', action: 'create_event', mapArgs: (a) => ({ summary: a.title, description: a.description, start: a.start_time, end: a.end_time, attendees: a.attendees, location: a.location }) },
  // Tier 2: Calendar Pro — additive
  calendar_list_calendars: { fn: 'google-calendar', action: 'list_calendars' },
  calendar_list_events: { fn: 'google-calendar', action: 'list_events', mapArgs: (a) => ({ calendarId: a.calendarId, timeMin: a.timeMin, timeMax: a.timeMax, q: a.q, maxResults: a.maxResults }) },
  calendar_get_event: { fn: 'google-calendar', action: 'get_event', mapArgs: (a) => ({ calendarId: a.calendarId, eventId: a.eventId }) },
  calendar_update_event: { fn: 'google-calendar', action: 'update_event', mapArgs: (a) => ({ calendarId: a.calendarId, eventId: a.eventId, event: a.event }) },
  calendar_delete_event: { fn: 'google-calendar', action: 'delete_event', mapArgs: (a) => ({ calendarId: a.calendarId, eventId: a.eventId }) },
  calendar_quick_add: { fn: 'google-calendar', action: 'quick_add', mapArgs: (a) => ({ calendarId: a.calendarId, text: a.text }) },
  calendar_freebusy: { fn: 'google-calendar', action: 'freebusy_query', mapArgs: (a) => ({ timeMin: a.timeMin, timeMax: a.timeMax, calendarIds: a.calendarIds }) },
  calendar_find_free_slots: { fn: 'google-calendar', action: 'find_free_slots', mapArgs: (a) => ({ calendarId: a.calendarId, timeMin: a.timeMin, timeMax: a.timeMax, durationMins: a.durationMins }) },
  calendar_move_event: { fn: 'google-calendar', action: 'move_event', mapArgs: (a) => ({ calendarId: a.calendarId, eventId: a.eventId, destination: a.destination }) },
  calendar_respond_to_event: { fn: 'google-calendar', action: 'respond_to_event', mapArgs: (a) => ({ calendarId: a.calendarId, eventId: a.eventId, attendeeEmail: a.attendeeEmail, responseStatus: a.responseStatus }) },
  calendar_add_attendees: { fn: 'google-calendar', action: 'add_attendees', mapArgs: (a) => ({ calendarId: a.calendarId, eventId: a.eventId, attendees: a.attendees }) },
  calendar_create_event_with_meet: { fn: 'google-calendar', action: 'create_event_with_meet', mapArgs: (a) => {
    const attendeesArr = typeof a.attendees === 'string' ? (a.attendees as string).split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email })) : a.attendees;
    return { calendarId: a.calendarId, event: { summary: a.summary, description: a.description, start: { dateTime: a.start_time }, end: { dateTime: a.end_time }, attendees: attendeesArr } };
  } },
  calendar_create_calendar: { fn: 'google-calendar', action: 'create_calendar', mapArgs: (a) => ({ summary: a.summary, timeZone: a.timeZone }) },
  calendar_set_event_reminders: { fn: 'google-calendar', action: 'set_event_reminders', mapArgs: (a) => ({ calendarId: a.calendarId, eventId: a.eventId, reminderMinutes: a.reminderMinutes, method: a.method }) },
  calendar_list_colors: { fn: 'google-calendar', action: 'list_colors' },
  // Tier 3: Drive Pro — additive
  drive_list_files: { fn: 'google-drive', action: 'list_files', mapArgs: (a) => ({ q: a.q, pageSize: a.pageSize, pageToken: a.pageToken }) },
  drive_get_file: { fn: 'google-drive', action: 'get_file', mapArgs: (a) => ({ id: a.id }) },
  drive_create_folder: { fn: 'google-drive', action: 'create_folder', mapArgs: (a) => ({ name: a.name, parents: a.parents }) },
  drive_move_file: { fn: 'google-drive', action: 'move_file', mapArgs: (a) => ({ id: a.id, newParentId: a.newParentId }) },
  drive_copy_file: { fn: 'google-drive', action: 'copy_file', mapArgs: (a) => ({ id: a.id, name: a.name }) },
  drive_rename_file: { fn: 'google-drive', action: 'rename_file', mapArgs: (a) => ({ id: a.id, name: a.name }) },
  drive_trash_file: { fn: 'google-drive', action: 'trash_file', mapArgs: (a) => ({ id: a.id }) },
  drive_untrash_file: { fn: 'google-drive', action: 'untrash_file', mapArgs: (a) => ({ id: a.id }) },
  drive_share_file: { fn: 'google-drive', action: 'share_file', mapArgs: (a) => ({ id: a.id, emailAddress: a.emailAddress, role: a.role, type: a.type }) },
  drive_list_permissions: { fn: 'google-drive', action: 'list_permissions', mapArgs: (a) => ({ id: a.id }) },
  drive_remove_permission: { fn: 'google-drive', action: 'remove_permission', mapArgs: (a) => ({ fileId: a.fileId, permissionId: a.permissionId }) },
  drive_storage_quota: { fn: 'google-drive', action: 'get_storage_quota' },
  // Tier 3: Docs Pro — additive
  docs_list_documents: { fn: 'google-docs', action: 'list_documents', mapArgs: (a) => ({ pageSize: a.pageSize }) },
  docs_get_document: { fn: 'google-docs', action: 'get_document', mapArgs: (a) => ({ documentId: a.documentId }) },
  docs_insert_text: { fn: 'google-docs', action: 'insert_text', mapArgs: (a) => ({ documentId: a.documentId, text: a.text, index: a.index }) },
  docs_replace_text: { fn: 'google-docs', action: 'replace_text', mapArgs: (a) => ({ documentId: a.documentId, find: a.find, replaceText: a.replaceText }) },
  docs_batch_update: { fn: 'google-docs', action: 'batch_update', mapArgs: (a) => ({ documentId: a.documentId, requests: a.requests }) },
  docs_apply_markdown: { fn: 'google-docs', action: 'apply_markdown', mapArgs: (a) => ({ documentId: a.documentId, markdown: a.markdown, replaceAll: a.replaceAll }) },
  docs_format_as_report: { fn: 'google-docs', action: 'format_as_report', mapArgs: (a) => ({ documentId: a.documentId }) },
  docs_style_range: { fn: 'google-docs', action: 'style_range', mapArgs: (a) => ({ documentId: a.documentId, startIndex: a.startIndex, endIndex: a.endIndex, bold: a.bold, italic: a.italic, fontSize: a.fontSize, foregroundColor: a.foregroundColor, link: a.link }) },
  docs_clear_formatting: { fn: 'google-docs', action: 'clear_formatting', mapArgs: (a) => ({ documentId: a.documentId, startIndex: a.startIndex, endIndex: a.endIndex }) },
  // Tier 3: Sheets Pro — additive
  sheets_list_spreadsheets: { fn: 'google-sheets', action: 'list_spreadsheets', mapArgs: (a) => ({ pageSize: a.pageSize }) },
  sheets_get_spreadsheet: { fn: 'google-sheets', action: 'get_spreadsheet', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId }) },
  sheets_read_range: { fn: 'google-sheets', action: 'read_range', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, range: a.range, valueRenderOption: a.valueRenderOption }) },
  sheets_write_range: { fn: 'google-sheets', action: 'write_range', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, range: a.range, values: a.values, valueInputOption: a.valueInputOption }) },
  sheets_append_rows: { fn: 'google-sheets', action: 'append_rows', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, range: a.range, values: a.values }) },
  sheets_clear_range: { fn: 'google-sheets', action: 'clear_range', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, range: a.range }) },
  sheets_create_spreadsheet: { fn: 'google-sheets', action: 'create_spreadsheet', mapArgs: (a) => ({ title: a.title }) },
  sheets_add_sheet: { fn: 'google-sheets', action: 'add_sheet', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, title: a.title }) },
  sheets_delete_sheet: { fn: 'google-sheets', action: 'delete_sheet', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, sheetId: a.sheetId }) },
  sheets_get_values_batch: { fn: 'google-sheets', action: 'get_values_batch', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, ranges: a.ranges }) },
  sheets_batch_update: { fn: 'google-sheets', action: 'batch_update', mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, requests: a.requests }) },
  // Tier 3: Slides Pro — additive
  slides_list_presentations: { fn: 'google-slides', action: 'list_presentations', mapArgs: (a) => ({ pageSize: a.pageSize }) },
  slides_get_presentation: { fn: 'google-slides', action: 'get_presentation', mapArgs: (a) => ({ presentationId: a.presentationId }) },
  slides_add_slide: { fn: 'google-slides', action: 'add_slide', mapArgs: (a) => ({ presentationId: a.presentationId, layout: a.layout, insertionIndex: a.insertionIndex }) },
  slides_delete_slide: { fn: 'google-slides', action: 'delete_slide', mapArgs: (a) => ({ presentationId: a.presentationId, objectId: a.objectId }) },
  slides_replace_text: { fn: 'google-slides', action: 'replace_text', mapArgs: (a) => ({ presentationId: a.presentationId, find: a.find, replace: a.replace, matchCase: a.matchCase }) },
  slides_batch_update: { fn: 'google-slides', action: 'batch_update', mapArgs: (a) => ({ presentationId: a.presentationId, requests: a.requests }) },
  slides_get_thumbnail: { fn: 'google-slides', action: 'get_thumbnail', mapArgs: (a) => ({ presentationId: a.presentationId, pageObjectId: a.pageObjectId, mimeType: a.mimeType, thumbnailSize: a.thumbnailSize }) },
  // GSC
  gsc_list_sites: { fn: 'google-search-console', action: 'list_sites' },
  gsc_query: { fn: 'google-search-console', action: 'search_analytics', mapArgs: (a) => ({ siteUrl: a.site_url, startDate: a.start_date, endDate: a.end_date, dimensions: a.dimensions, rowLimit: a.row_limit }) },
};

async function tryNativeGoogleCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; result: string } | null> {
  const route = NATIVE_GOOGLE_ROUTES[toolName];
  if (!route) return null;

  const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
  if (!authHeader) return null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    // FIX: All native Google receivers expect { action, params: {...} } (nested envelope).
    // The old code spread mapped args at the top level, so receivers saw params={} and
    // every required field read as empty (e.g. "documentId and text are required").
    const payload = {
      action: route.action,
      params: route.mapArgs ? route.mapArgs(args) : args,
    };
    const res = await fetch(`${supabaseUrl}/functions/v1/${route.fn}`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'apikey': anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok || data?.success === false) {
      const errMsg = (data?.error as string) || (data?.raw as string) || `HTTP ${res.status}`;
      console.warn(`[NativeGoogle] ${toolName} → ${route.fn}/${route.action} FAILED: ${errMsg}`);
      // Surface the real error to the AI instead of swallowing it (which previously
      // caused "Unknown tool" fall-through and hid actionable failures).
      return { success: false, result: `${toolName} failed: ${errMsg}` };
    }
    console.log(`[NativeGoogle] ${toolName} → ${route.fn}/${route.action} OK`);
    return { success: true, result: `[Native Google Workspace] ${JSON.stringify(data).slice(0, 4000)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[NativeGoogle] ${toolName} error:`, msg);
    return { success: false, result: `${toolName} error: ${msg}` };
  }
}

// ============================================================================
// NATIVE EDGE FUNCTION INVOKER
// Calls a Supabase edge function with the user's auth token.
// All Google services route through here.
// ============================================================================
async function callNativeEdge(
  fn: string,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
  if (!authHeader) throw new Error('No auth context — user must be signed in');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, params }),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data?.success === false) {
    const errMsg = (data?.error as string) || (data?.raw as string) || `${fn}/${action} failed (${res.status})`;
    throw new Error(errMsg);
  }
  return data;
}

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  _connMap: MultiConnMap,
  _userMessage?: string,
  _aliasMap?: AliasEntry[],
  ghlCreds?: { apiKey?: string; locationId?: string; subAccounts?: { id: string; name: string; api_key?: string; scopes?: string[]; location_name?: string; disabled?: boolean; last_verified_at?: string }[] },
): Promise<{ success: boolean; result: string; structured?: Record<string, unknown> }> {
  try {
    // ---- multi_action: parallel fan-out ----
    if (toolName === 'multi_action') {
      const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
      const calls = Array.isArray(args.calls) ? (args.calls as { name: string; args: Record<string, unknown> }[]) : [];
      if (!authHeader || calls.length === 0) {
        return { success: false, result: 'multi_action requires auth and at least one call' };
      }
      const results = await dispatchMulti(
        calls,
        authHeader,
        // Fallback: tools not in registry → recurse into legacy switch via executeToolCall.
        async (name, a) => await executeToolCall(name, a, _connMap, _userMessage, _aliasMap, ghlCreds),
      );
      const okCount = results.filter((r) => r.success).length;
      return {
        success: okCount === results.length,
        result: `multi_action: ${okCount}/${results.length} succeeded\n` +
          results.map((r) => `  • ${r.success ? '✓' : '✗'} ${r.name}: ${r.result.slice(0, 200)}`).join('\n'),
      };
    }

    // ---- load_skill: fetch + activate a user-installed skill ----
    if (toolName === 'load_skill') {
      const slug = String(args.slug || '').trim();
      const userId = (globalThis as Record<string, unknown>).__currentUserId as string | undefined;
      if (!slug) return { success: false, result: 'load_skill: slug is required' };
      if (!userId) return { success: false, result: 'load_skill: user not authenticated' };
      const skill = await getSkillBySlug(userId, slug);
      if (!skill) {
        return { success: false, result: `Skill "${slug}" is not installed for this user.` };
      }
      // Mode-guard: defense in depth — even if the model ignores the gated index,
      // disallowed modes must not be able to activate the skill at runtime.
      const currentMode = (globalThis as Record<string, unknown>).__currentMode as string | undefined;
      const allowed = (skill.manifest as { modes_allowed?: string[] } | undefined)?.modes_allowed;
      if (currentMode && Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(currentMode)) {
        return {
          success: false,
          result: `Skill "${slug}" is not allowed in ${currentMode} mode (allowed: ${allowed.join(", ")}).`,
        };
      }
      const m = skill.manifest;
      // Best-effort audit (non-blocking)
      recordInvocation({
        userId,
        skillId: skill.id,
        triggerType: 'load_skill',
        triggerPayload: { slug },
      }).catch(() => {});
      const memoryDomains = Array.isArray(m.memory_domains) ? m.memory_domains.filter((d): d is string => typeof d === 'string') : [];
      const block = [
        `## Skill activated: ${m.name} (v${m.version})`,
        `Description: ${m.description}`,
        m.requires_confirmation ? `⚠ Requires user confirmation before any write/destructive action.` : '',
        `Tools available for this skill: ${[...(m.tools_required || []), ...(m.tools_optional || [])].join(', ') || '(none)'}`,
        memoryDomains.length ? `Memory scope for this skill: ${memoryDomains.join(', ')} — when calling search_wisdom_memories, pass memory_type from this list to stay focused.` : '',
        '',
        '### Instructions',
        m.instructions,
      ].filter(Boolean).join('\n');
      return { success: true, result: block };
    }

    // ---- update_skill / add_skill_prerequisites: patch an installed skill ----
    if (toolName === 'update_skill' || toolName === 'add_skill_prerequisites') {
      const userId = (globalThis as Record<string, unknown>).__currentUserId as string | undefined;
      const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
      if (!userId || !authHeader) {
        return { success: false, result: `${toolName}: user not authenticated` };
      }
      const slug = String(args.slug || '').trim();
      if (!slug) return { success: false, result: `${toolName}: slug is required` };

      let payload: Record<string, unknown>;
      if (toolName === 'add_skill_prerequisites') {
        const prereqs = Array.isArray(args.prerequisites)
          ? (args.prerequisites as unknown[]).map(String).filter(Boolean)
          : [];
        if (prereqs.length === 0) {
          return { success: false, result: 'add_skill_prerequisites: prerequisites array required' };
        }
        payload = { op: 'append_prerequisites', slug, prerequisites: prereqs };
      } else {
        // update_skill: either patch_instructions or update_manifest depending on args.
        if (args.manifest_patch && typeof args.manifest_patch === 'object') {
          payload = { op: 'update_manifest', slug, patch: args.manifest_patch };
        } else {
          const content = String(args.content ?? args.instructions_patch ?? '').trim();
          if (!content) {
            return { success: false, result: 'update_skill: content (or manifest_patch) required' };
          }
          payload = {
            op: 'patch_instructions',
            slug,
            mode: (args.merge_strategy as string) === 'replace_section' ? 'replace_section'
              : (args.merge_strategy as string) === 'prepend' ? 'prepend' : 'append',
            section: args.section ? String(args.section) : undefined,
            content,
          };
        }
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      try {
        const r = await fetch(`${supabaseUrl}/functions/v1/skills-edit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) {
          return {
            success: false,
            result: `Skill edit failed: ${data.error || r.status}${data.scan ? ` — scan ${data.scan.verdict} (${data.scan.findings?.length || 0} findings)` : ''}`,
          };
        }
        const lines = [
          `Skill updated: ${data.slug} → v${data.version} (op: ${data.op})`,
          data.forked_from ? `Forked from "${data.forked_from}" into your private copy.` : null,
          `Effective instructions (${data.effective_instructions_length} chars), preview:`,
          data.effective_instructions_summary,
        ].filter(Boolean);
        return { success: true, result: lines.join('\n') };
      } catch (e) {
        return { success: false, result: `Skill edit error: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // ---- Registry dispatcher (manifest-driven tools) ----
    const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
    if (authHeader) {
      // For GHL tools, forward the chat-resolved per-sub-account credentials so the
      // gohighlevel edge function uses the correct API key for the active sub-account
      // (otherwise it falls back to the primary connection key → 403 on other locations).
      let extra: Record<string, unknown> | undefined;
      if (toolName.startsWith('ghl_') && ghlCreds?.apiKey && ghlCreds?.locationId) {
        extra = { apiKey: ghlCreds.apiKey, locationId: ghlCreds.locationId };
      }
      const dispatched = await dispatchTool(toolName, args, authHeader, extra);
      if (dispatched.routed) return { success: dispatched.success, result: dispatched.result, structured: dispatched.data as Record<string, unknown> | undefined };
    }

    // Native Google routes (docs_*, sheets_*, slides_*, drive_*, gmail_*, gsc_*) are
    // dispatched via NATIVE_GOOGLE_ROUTES → their dedicated edge function. This MUST
    // run before the switch so tools listed only in the route map (e.g. docs_apply_markdown,
    // docs_format_as_report, docs_style_range, docs_clear_formatting) don't fall through
    // to "Unknown tool".
    const native = await tryNativeGoogleCall(toolName, args);
    if (native) return native;

    switch (toolName) {
      // ============ Gmail ============
      case 'send_email': {
        try {
          const data = await callNativeEdge('google-gmail', 'send_message', {
            to: args.to, subject: args.subject, body: args.body, cc: args.cc,
          });
          const msg = data.message as { id?: string } | undefined;
          return { success: true, result: `Email sent (ID: ${msg?.id || 'unknown'}). To: ${args.to}, Subject: "${args.subject}"` };
        } catch (e) { return { success: false, result: `Failed to send: ${(e as Error).message}` }; }
      }

      case 'create_email_draft': {
        try {
          const data = await callNativeEdge('google-gmail', 'create_draft', {
            to: args.to, subject: args.subject, body: args.body,
          });
          const draft = data.draft as { id?: string } | undefined;
          return { success: true, result: `Draft created (ID: ${draft?.id || 'unknown'}). To: ${args.to}, Subject: "${args.subject}"` };
        } catch (e) { return { success: false, result: `Failed to create draft: ${(e as Error).message}` }; }
      }

      case 'list_emails': {
        try {
          const data = await callNativeEdge('google-gmail', 'list_messages', {
            q: args.query, maxResults: Math.min((args.max_results as number) || 50, 100),
          });
          const msgs = (data.messages as { id: string }[]) || [];
          if (!msgs.length) return { success: true, result: `No emails found matching "${args.query}"` };
          const batch = msgs.slice(0, 50);
          const details = await Promise.all(batch.map(async (m) => {
            try {
              const full = await callNativeEdge('google-gmail', 'get_message', { id: m.id, format: 'full' });
              const message = full.message as { payload?: { headers?: { name: string; value: string }[] } } | undefined;
              const headers = message?.payload?.headers || [];
              const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
              const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
              const date = headers.find(h => h.name === 'Date')?.value || '';
              return `- ID: ${m.id} | From: ${from} | Subject: ${subject} | ${date}`;
            } catch { return `- ID: ${m.id} | (metadata unavailable)`; }
          }));
          return { success: true, result: [`Found ~${data.resultSizeEstimate || msgs.length} emails. Showing ${batch.length}:`, ...details].join('\n') };
        } catch (e) { return { success: false, result: `Failed to list emails: ${(e as Error).message}` }; }
      }

      case 'get_email': {
        try {
          const data = await callNativeEdge('google-gmail', 'get_message', { id: args.message_id, format: 'full' });
          const full = data.message as { payload?: { headers?: { name: string; value: string }[]; parts?: { mimeType?: string; body?: { data?: string } }[]; body?: { data?: string } }; snippet?: string; labelIds?: string[] };
          const headers = full?.payload?.headers || [];
          const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          const date = headers.find(h => h.name === 'Date')?.value || '';
          const to = headers.find(h => h.name === 'To')?.value || '';
          let bodyText = '';
          const bodyData = full?.payload?.body?.data || full?.payload?.parts?.find(p => p.mimeType === 'text/plain')?.body?.data;
          if (bodyData) {
            try { bodyText = atob(bodyData.replace(/-/g, '+').replace(/_/g, '/')); } catch { bodyText = full?.snippet || ''; }
          } else {
            bodyText = full?.snippet || '';
          }
          return { success: true, result: `From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\nLabels: ${(full?.labelIds || []).join(', ')}\n\n${bodyText.substring(0, 2000)}` };
        } catch (e) { return { success: false, result: `Failed to get email: ${(e as Error).message}` }; }
      }

      case 'trash_email': {
        try {
          await callNativeEdge('google-gmail', 'trash_message', { id: args.message_id });
          return { success: true, result: `Email ${args.message_id} moved to trash.` };
        } catch (e) { return { success: false, result: `Failed to trash email: ${(e as Error).message}` }; }
      }

      case 'batch_trash_emails': {
        const ids = (args.message_ids as string).split(',').map(id => id.trim()).filter(Boolean);
        if (!ids.length) return { success: false, result: 'No message IDs provided.' };
        const failures: string[] = [];
        let successCount = 0;
        const chunkSize = 10;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (id) => {
            try {
              await callNativeEdge('google-gmail', 'trash_message', { id });
              successCount++;
            } catch (e) { failures.push(`${id}: ${(e as Error).message}`); }
          }));
        }
        const detail = failures.length ? ` (${failures.slice(0, 5).join(', ')}${failures.length > 5 ? '...' : ''})` : '';
        return { success: successCount > 0, result: `Batch trash: ${successCount} trashed, ${failures.length} failed${detail}.` };
      }

      case 'list_email_ids': {
        try {
          const data = await callNativeEdge('google-gmail', 'list_messages', {
            q: args.query, maxResults: Math.min((args.max_results as number) || 100, 500), pageToken: args.page_token,
          });
          const msgs = (data.messages as { id: string }[]) || [];
          if (!msgs.length) return { success: true, result: JSON.stringify({ ids: [], total: 0 }) };
          return { success: true, result: JSON.stringify({ ids: msgs.map(m => m.id), nextPageToken: data.nextPageToken || null, total: data.resultSizeEstimate || msgs.length }) };
        } catch (e) { return { success: false, result: `Failed to list email IDs: ${(e as Error).message}` }; }
      }

      case 'label_email': {
        try {
          const params: Record<string, unknown> = { id: args.message_id };
          if (args.add_labels) params.addLabelIds = (args.add_labels as string).split(',').map(l => l.trim());
          if (args.remove_labels) params.removeLabelIds = (args.remove_labels as string).split(',').map(l => l.trim());
          await callNativeEdge('google-gmail', 'modify_message', params);
          return { success: true, result: `Labels updated on email ${args.message_id}.` };
        } catch (e) { return { success: false, result: `Label modification failed: ${(e as Error).message}` }; }
      }

      case 'mark_email_read': {
        try {
          await callNativeEdge('google-gmail', 'modify_message', { id: args.message_id, removeLabelIds: ['UNREAD'] });
          return { success: true, result: `Email ${args.message_id} marked as read.` };
        } catch (e) { return { success: false, result: `Failed to mark as read: ${(e as Error).message}` }; }
      }

      // ============ Google Calendar ============
      case 'create_calendar_event': {
        try {
          const event: Record<string, unknown> = {
            summary: args.summary,
            start: { dateTime: args.start_time },
            end: { dateTime: args.end_time },
          };
          if (args.description) event.description = args.description;
          if (args.location) event.location = args.location;
          if (args.attendees) {
            event.attendees = (args.attendees as string).split(',').map(e => ({ email: e.trim() }));
          }
          const data = await callNativeEdge('google-calendar', 'create_event', { calendarId: 'primary', event });
          const created = data.event as { id?: string; htmlLink?: string } | undefined;
          return { success: true, result: `Calendar event created: "${args.summary}" from ${args.start_time} to ${args.end_time}${created?.htmlLink ? ` - ${created.htmlLink}` : ''}` };
        } catch (e) { return { success: false, result: `Failed to create event: ${(e as Error).message}` }; }
      }

      // ============ Google Drive ============
      case 'search_google_drive': {
        try {
          const data = await callNativeEdge('google-drive', 'search_files', { name: args.query });
          const files = (data.files as { id: string; name: string; mimeType: string; webViewLink?: string }[]) || [];
          if (!files.length) return { success: true, result: `No files found matching "${args.query}"` };
          const max = (args.max_results as number) || 10;
          const shown = files.slice(0, max);
          return { success: true, result: `Found ${files.length} files:\n${shown.map(f => `- ${f.name} (${f.mimeType?.split('.').pop()}) - ${f.webViewLink || ''}`).join('\n')}` };
        } catch (e) { return { success: false, result: `Drive search failed: ${(e as Error).message}` }; }
      }

      // ============ GoHighLevel tools ============
      case 'ghl_list_contacts': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const query = args.query ? `&query=${encodeURIComponent(args.query as string)}` : '';
        const data = await callGHL(`/contacts/?locationId=${GHL_LOCATION_ID}&limit=${limit}${query}`, 'GET', undefined, ghlCreds?.apiKey) as { contacts?: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string; tags?: string[] }[] };
        const contacts = data.contacts || [];
        if (!contacts.length) return { success: true, result: 'No contacts found.' };
        return { success: true, result: `Found ${contacts.length} contacts:\n${contacts.map(c => `- ${c.firstName || ''} ${c.lastName || ''} | ${c.email || 'no email'} | ${c.phone || 'no phone'} | ID: ${c.id}${c.tags?.length ? ' | Tags: ' + c.tags.join(', ') : ''}`).join('\n')}` };
      }

      case 'ghl_create_contact': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const contactData: Record<string, unknown> = {
          locationId: GHL_LOCATION_ID,
          firstName: args.firstName,
          lastName: args.lastName,
          email: args.email,
        };
        if (args.phone) contactData.phone = args.phone;
        if (args.source) contactData.source = args.source;
        if (args.tags) contactData.tags = (args.tags as string).split(',').map(t => t.trim());
        const res = await callGHL('/contacts/', 'POST', contactData, ghlCreds?.apiKey) as { contact?: { id: string; firstName?: string; lastName?: string }; error?: string; message?: string };
        if (res.error || res.message) return { success: false, result: `GHL error: ${res.error || res.message}` };
        return { success: true, result: `Contact created: ${res.contact?.firstName} ${res.contact?.lastName} (ID: ${res.contact?.id})` };
      }

      case 'ghl_create_opportunity': {
        const data: Record<string, unknown> = {
          pipelineId: args.pipeline_id,
          pipelineStageId: args.stage_id,
          name: args.name,
          contactId: args.contact_id,
          status: args.status || 'open',
        };
        if (args.monetary_value) data.monetaryValue = args.monetary_value;
        const res = await callGHL('/opportunities/', 'POST', data, ghlCreds?.apiKey) as { opportunity?: { id: string; name: string }; error?: string; message?: string };
        if (res.error || res.message) return { success: false, result: `GHL error: ${res.error || res.message}` };
        return { success: true, result: `Opportunity created: "${res.opportunity?.name}" (ID: ${res.opportunity?.id})` };
      }

      case 'ghl_list_opportunities': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const data = await callGHL(`/opportunities/search?locationId=${GHL_LOCATION_ID}&pipelineId=${args.pipeline_id}&limit=${limit}`, 'GET', undefined, ghlCreds?.apiKey) as { opportunities?: { id: string; name: string; monetaryValue?: number; status?: string; pipelineStageId?: string; contact?: { name?: string } }[] };
        const opps = data.opportunities || [];
        if (!opps.length) return { success: true, result: 'No opportunities found in this pipeline.' };
        return { success: true, result: `Found ${opps.length} opportunities:\n${opps.map(o => `- ${o.name} | $${o.monetaryValue || 0} | Status: ${o.status || '?'} | ID: ${o.id}`).join('\n')}` };
      }

      case 'ghl_list_pipelines': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { pipelines?: { id: string; name: string; stages?: { id: string; name: string }[] }[] };
        const pipelines = data.pipelines || [];
        if (!pipelines.length) return { success: true, result: 'No pipelines found.' };
        return { success: true, result: `Pipelines:\n${pipelines.map(p => `- ${p.name} (ID: ${p.id})\n  Stages: ${(p.stages || []).map(s => `${s.name} (ID: ${s.id})`).join(' → ')}`).join('\n')}` };
      }

      case 'ghl_send_message': {
        const type = (args.type as string) || 'SMS';
        const msgData: Record<string, unknown> = {
          type,
          contactId: args.contact_id,
          message: args.message,
        };
        if (type === 'Email' && args.subject) msgData.subject = args.subject;
        const res = await callGHL('/conversations/messages', 'POST', msgData, ghlCreds?.apiKey) as { messageId?: string; message?: string; error?: string };
        if (res.error) return { success: false, result: `GHL message error: ${res.error}` };
        return { success: true, result: `${type} sent to contact ${args.contact_id}: "${(args.message as string).substring(0, 100)}"` };
      }

      case 'ghl_list_calendars': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/calendars/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { calendars?: { id: string; name: string; description?: string }[] };
        const cals = data.calendars || [];
        if (!cals.length) return { success: true, result: 'No calendars found.' };
        return { success: true, result: `Calendars:\n${cals.map(c => `- ${c.name} (ID: ${c.id})${c.description ? ' - ' + c.description : ''}`).join('\n')}` };
      }

      case 'ghl_book_appointment': {
        const apptData: Record<string, unknown> = {
          calendarId: args.calendar_id,
          contactId: args.contact_id,
          startTime: args.start_time,
          endTime: args.end_time,
        };
        if (args.title) apptData.title = args.title;
        const res = await callGHL('/calendars/events/appointments', 'POST', apptData, ghlCreds?.apiKey) as { id?: string; error?: string; message?: string };
        if (res.error || res.message) return { success: false, result: `GHL appointment error: ${res.error || res.message}` };
        return { success: true, result: `Appointment booked: ${args.start_time} to ${args.end_time} (ID: ${res.id})` };
      }

      case 'ghl_add_tags': {
        const tags = (args.tags as string).split(',').map(t => t.trim());
        const res = await callGHL(`/contacts/${args.contact_id}/tags`, 'POST', { tags }, ghlCreds?.apiKey) as { tags?: string[]; error?: string };
        if (res.error) return { success: false, result: `GHL tag error: ${res.error}` };
        return { success: true, result: `Tags added to contact ${args.contact_id}: ${tags.join(', ')}` };
      }

      case 'ghl_list_workflows': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/workflows/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { workflows?: { id: string; name: string; status?: string }[] };
        const workflows = data.workflows || [];
        if (!workflows.length) return { success: true, result: 'No workflows found.' };
        return { success: true, result: `Workflows:\n${workflows.map(w => `- ${w.name} (${w.status || 'unknown'}) | ID: ${w.id}`).join('\n')}` };
      }

      case 'ghl_list_campaigns': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/campaigns/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { campaigns?: { id: string; name: string; status?: string }[] };
        const camps = data.campaigns || [];
        if (!camps.length) return { success: true, result: 'No campaigns found.' };
        return { success: true, result: `Campaigns:\n${camps.map(c => `- ${c.name} (${c.status || 'unknown'}) | ID: ${c.id}`).join('\n')}` };
      }

      // ============ Tier 1: New GHL tool handlers ============
      case 'ghl_get_contact': {
        const data = await callGHL(`/contacts/${args.contact_id}`, 'GET', undefined, ghlCreds?.apiKey) as { contact?: Record<string, unknown>; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        const c = data.contact as Record<string, unknown> | undefined;
        if (!c) return { success: false, result: 'Contact not found.' };
        return { success: true, result: `Contact: ${c.firstName || ''} ${c.lastName || ''}\nEmail: ${c.email || 'N/A'}\nPhone: ${c.phone || 'N/A'}\nTags: ${(c.tags as string[])?.join(', ') || 'none'}\nSource: ${c.source || 'N/A'}\nDate Added: ${c.dateAdded || 'N/A'}\nID: ${c.id}` };
      }

      case 'ghl_update_contact': {
        const updateData: Record<string, unknown> = {};
        if (args.firstName) updateData.firstName = args.firstName;
        if (args.lastName) updateData.lastName = args.lastName;
        if (args.email) updateData.email = args.email;
        if (args.phone) updateData.phone = args.phone;
        if (args.tags) updateData.tags = (args.tags as string).split(',').map(t => t.trim());
        if (args.customFields) { try { updateData.customFields = JSON.parse(args.customFields as string); } catch { /* ignore */ } }
        const res = await callGHL(`/contacts/${args.contact_id}`, 'PUT', updateData, ghlCreds?.apiKey) as { contact?: { id: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Contact ${args.contact_id} updated successfully.` };
      }

      case 'ghl_search_contacts': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const rawLimit = Number(args.limit ?? 20);
        const pageLimit = Math.max(1, Math.min(100, isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20));
        const searchBody: Record<string, unknown> = { locationId: GHL_LOCATION_ID, pageLimit };
        if (args.query) searchBody.query = String(args.query);
        if (args.filters) { try { Object.assign(searchBody, JSON.parse(args.filters as string)); } catch { /* ignore */ } }
        const data = await callGHL('/contacts/search', 'POST', searchBody, ghlCreds?.apiKey) as { contacts?: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string }[] };
        const contacts = data.contacts || [];
        if (!contacts.length) return { success: true, result: 'No contacts found matching search.' };
        return { success: true, result: `Found ${contacts.length} contacts:\n${contacts.map(c => `- ${c.firstName || ''} ${c.lastName || ''} | ${c.email || ''} | ${c.phone || ''} | ID: ${c.id}`).join('\n')}` };
      }

      case 'ghl_update_opportunity': {
        const updateData: Record<string, unknown> = {};
        if (args.stage_id) updateData.pipelineStageId = args.stage_id;
        if (args.monetary_value) updateData.monetaryValue = args.monetary_value;
        if (args.status) updateData.status = args.status;
        if (args.name) updateData.name = args.name;
        const res = await callGHL(`/opportunities/${args.opportunity_id}`, 'PUT', updateData, ghlCreds?.apiKey) as { opportunity?: { id: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Opportunity ${args.opportunity_id} updated successfully.` };
      }

      case 'ghl_get_calendar_events': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const startTime = (args.start_time as string) || new Date().toISOString();
        const endTime = (args.end_time as string) || new Date(Date.now() + 7 * 86400000).toISOString();
        const data = await callGHL(`/calendars/events?locationId=${GHL_LOCATION_ID}&calendarId=${args.calendar_id}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`, 'GET', undefined, ghlCreds?.apiKey) as { events?: { id: string; title?: string; startTime?: string; endTime?: string; contactId?: string; status?: string }[] };
        const events = data.events || [];
        if (!events.length) return { success: true, result: 'No events found in this time range.' };
        return { success: true, result: `Found ${events.length} events:\n${events.map(e => `- ${e.title || '(untitled)'} | ${e.startTime} → ${e.endTime} | Status: ${e.status || '?'} | ID: ${e.id}`).join('\n')}` };
      }

      case 'ghl_get_free_slots': {
        const startDate = (args.start_date as string) || new Date().toISOString().split('T')[0];
        const endDate = (args.end_date as string) || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        const data = await callGHL(`/calendars/${args.calendar_id}/free-slots?startDate=${startDate}&endDate=${endDate}`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, { slots?: string[] }>;
        const allSlots: string[] = [];
        for (const [date, info] of Object.entries(data)) {
          if (info?.slots?.length) { allSlots.push(`${date}: ${info.slots.join(', ')}`); }
        }
        if (!allSlots.length) return { success: true, result: 'No free slots available in this date range.' };
        return { success: true, result: `Free slots:\n${allSlots.join('\n')}` };
      }

      case 'ghl_list_conversations': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const data = await callGHL(`/conversations/search?locationId=${GHL_LOCATION_ID}&limit=${limit}`, 'GET', undefined, ghlCreds?.apiKey) as { conversations?: { id: string; contactId?: string; type?: string; lastMessageDate?: string; fullName?: string }[] };
        const convos = data.conversations || [];
        if (!convos.length) return { success: true, result: 'No conversations found.' };
        return { success: true, result: `Found ${convos.length} conversations:\n${convos.map(c => `- ${c.fullName || 'Unknown'} | Type: ${c.type || '?'} | Last: ${c.lastMessageDate || '?'} | ID: ${c.id}`).join('\n')}` };
      }

      case 'ghl_get_conversation_messages': {
        const data = await callGHL(`/conversations/${args.conversation_id}/messages`, 'GET', undefined, ghlCreds?.apiKey) as { messages?: { id: string; body?: string; type?: string; direction?: string; dateAdded?: string }[] };
        const msgs = data.messages || [];
        if (!msgs.length) return { success: true, result: 'No messages in this conversation.' };
        return { success: true, result: `Messages (${msgs.length}):\n${msgs.slice(0, 30).map(m => `- [${m.direction || '?'}] ${m.body?.substring(0, 200) || '(empty)'} (${m.dateAdded || ''})`).join('\n')}` };
      }

      case 'ghl_list_invoices': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const data = await callGHL(`/invoices/?altId=${GHL_LOCATION_ID}&altType=location&limit=${limit}`, 'GET', undefined, ghlCreds?.apiKey) as { invoices?: { _id: string; name?: string; total?: number; status?: string; createdAt?: string }[] };
        const invoices = data.invoices || [];
        if (!invoices.length) return { success: true, result: 'No invoices found.' };
        return { success: true, result: `Invoices (${invoices.length}):\n${invoices.map(i => `- ${i.name || 'Untitled'} | $${i.total || 0} | ${i.status || '?'} | ID: ${i._id}`).join('\n')}` };
      }

      case 'ghl_create_invoice': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const invoiceData: Record<string, unknown> = { altId: GHL_LOCATION_ID, altType: 'location', name: args.name, contactId: args.contact_id };
        if (args.items) { try { invoiceData.items = JSON.parse(args.items as string); } catch { /* ignore */ } }
        const res = await callGHL('/invoices/', 'POST', invoiceData, ghlCreds?.apiKey) as { invoice?: { _id: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Invoice created: "${args.name}" (ID: ${res.invoice?._id})` };
      }

      case 'ghl_list_orders': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&limit=${(args.limit as number) || 20}`, 'GET', undefined, ghlCreds?.apiKey) as { data?: { id: string; name?: string; amount?: number; status?: string }[] };
        const orders = data.data || [];
        if (!orders.length) return { success: true, result: 'No orders found.' };
        return { success: true, result: `Orders (${orders.length}):\n${orders.map(o => `- ${o.name || 'Order'} | $${o.amount || 0} | ${o.status || '?'} | ID: ${o.id}`).join('\n')}` };
      }

      case 'ghl_list_transactions': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/payments/transactions?altId=${GHL_LOCATION_ID}&altType=location&limit=${(args.limit as number) || 20}`, 'GET', undefined, ghlCreds?.apiKey) as { data?: { id: string; amount?: number; status?: string; createdAt?: string }[] };
        const txns = data.data || [];
        if (!txns.length) return { success: true, result: 'No transactions found.' };
        return { success: true, result: `Transactions (${txns.length}):\n${txns.map(t => `- $${t.amount || 0} | ${t.status || '?'} | ${t.createdAt || ''} | ID: ${t.id}`).join('\n')}` };
      }

      case 'ghl_list_forms': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/forms/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { forms?: { id: string; name: string }[] };
        const forms = data.forms || [];
        if (!forms.length) return { success: true, result: 'No forms found.' };
        return { success: true, result: `Forms:\n${forms.map(f => `- ${f.name} | ID: ${f.id}`).join('\n')}` };
      }

      case 'ghl_get_form_submissions': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const data = await callGHL(`/forms/submissions?locationId=${GHL_LOCATION_ID}&formId=${args.form_id}&limit=${limit}`, 'GET', undefined, ghlCreds?.apiKey) as { submissions?: { id: string; contactId?: string; createdAt?: string; data?: Record<string, string> }[] };
        const subs = data.submissions || [];
        if (!subs.length) return { success: true, result: 'No submissions found for this form.' };
        return { success: true, result: `Submissions (${subs.length}):\n${subs.map(s => `- Contact: ${s.contactId || '?'} | ${s.createdAt || ''} | Data: ${JSON.stringify(s.data || {}).substring(0, 200)}`).join('\n')}` };
      }

      case 'ghl_list_funnels': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/funnels/funnel/list?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { funnels?: { id: string; name: string; steps?: number }[] };
        const funnels = data.funnels || [];
        if (!funnels.length) return { success: true, result: 'No funnels found.' };
        return { success: true, result: `Funnels:\n${funnels.map(f => `- ${f.name} | ID: ${f.id}`).join('\n')}` };
      }

      case 'ghl_list_custom_fields': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/locations/${GHL_LOCATION_ID}/customFields`, 'GET', undefined, ghlCreds?.apiKey) as { customFields?: { id: string; name: string; fieldKey?: string; dataType?: string }[] };
        const fields = data.customFields || [];
        if (!fields.length) return { success: true, result: 'No custom fields found.' };
        return { success: true, result: `Custom Fields:\n${fields.map(f => `- ${f.name} (${f.dataType || '?'}) | Key: ${f.fieldKey || f.id}`).join('\n')}` };
      }

      case 'ghl_list_custom_values': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/locations/${GHL_LOCATION_ID}/customValues`, 'GET', undefined, ghlCreds?.apiKey) as { customValues?: { id: string; name: string; value?: string }[] };
        const values = data.customValues || [];
        if (!values.length) return { success: true, result: 'No custom values found.' };
        return { success: true, result: `Custom Values:\n${values.map(v => `- ${v.name}: ${v.value || '(empty)'} | ID: ${v.id}`).join('\n')}` };
      }

      case 'ghl_list_users': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/users/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { users?: { id: string; name?: string; email?: string; role?: string }[] };
        const users = data.users || [];
        if (!users.length) return { success: true, result: 'No users found.' };
        return { success: true, result: `Users:\n${users.map(u => `- ${u.name || 'Unknown'} | ${u.email || ''} | ${u.role || '?'} | ID: ${u.id}`).join('\n')}` };
      }

      case 'ghl_list_tags': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/locations/${GHL_LOCATION_ID}/tags`, 'GET', undefined, ghlCreds?.apiKey) as { tags?: { id: string; name: string }[] };
        const tags = data.tags || [];
        if (!tags.length) return { success: true, result: 'No tags found.' };
        return { success: true, result: `Tags:\n${tags.map(t => `- ${t.name} | ID: ${t.id}`).join('\n')}` };
      }

      // ============ Tier 2: New GHL action handlers ============
      case 'ghl_delete_contact': {
        const res = await callGHL(`/contacts/${args.contact_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { succeded?: boolean; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Contact ${args.contact_id} deleted.` };
      }

      case 'ghl_add_contact_note': {
        const res = await callGHL(`/contacts/${args.contact_id}/notes`, 'POST', { body: args.body }, ghlCreds?.apiKey) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Note added to contact ${args.contact_id}.` };
      }

      case 'ghl_list_contact_notes': {
        const data = await callGHL(`/contacts/${args.contact_id}/notes`, 'GET', undefined, ghlCreds?.apiKey) as { notes?: { id: string; body?: string; dateAdded?: string }[] };
        const notes = data.notes || [];
        if (!notes.length) return { success: true, result: 'No notes found for this contact.' };
        return { success: true, result: `Notes (${notes.length}):\n${notes.map(n => `- ${n.body?.substring(0, 200) || '(empty)'} (${n.dateAdded || ''})`).join('\n')}` };
      }

      case 'ghl_add_contact_task': {
        const taskData: Record<string, unknown> = { title: args.title };
        if (args.body) taskData.body = args.body;
        if (args.dueDate) taskData.dueDate = args.dueDate;
        const res = await callGHL(`/contacts/${args.contact_id}/tasks`, 'POST', taskData, ghlCreds?.apiKey) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Task "${args.title}" added to contact ${args.contact_id}.` };
      }

      case 'ghl_list_contact_tasks': {
        const data = await callGHL(`/contacts/${args.contact_id}/tasks`, 'GET', undefined, ghlCreds?.apiKey) as { tasks?: { id: string; title?: string; body?: string; completed?: boolean; dueDate?: string }[] };
        const tasks = data.tasks || [];
        if (!tasks.length) return { success: true, result: 'No tasks found for this contact.' };
        return { success: true, result: `Tasks (${tasks.length}):\n${tasks.map(t => `- ${t.completed ? '✅' : '⬜'} ${t.title || '(untitled)'} | Due: ${t.dueDate || 'N/A'} | ID: ${t.id}`).join('\n')}` };
      }

      case 'ghl_remove_tags': {
        const tags = (args.tags as string).split(',').map(t => t.trim());
        const res = await callGHL(`/contacts/${args.contact_id}/tags`, 'DELETE', { tags }, ghlCreds?.apiKey) as { tags?: string[]; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Tags removed from contact ${args.contact_id}: ${tags.join(', ')}` };
      }

      case 'ghl_cancel_appointment': {
        const res = await callGHL(`/calendars/events/appointments/${args.event_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Appointment ${args.event_id} cancelled.` };
      }

      case 'ghl_update_appointment': {
        const updateBody: Record<string, unknown> = {};
        if (args.start_time) updateBody.startTime = args.start_time;
        if (args.end_time) updateBody.endTime = args.end_time;
        if (args.title) updateBody.title = args.title;
        if (args.appointment_status) updateBody.appointmentStatus = args.appointment_status;
        if (args.address) updateBody.address = args.address;
        if (args.assigned_user_id) updateBody.assignedUserId = args.assigned_user_id;
        if (args.calendar_id) updateBody.calendarId = args.calendar_id;
        if (Object.keys(updateBody).length === 0) {
          return { success: false, result: 'No fields provided to update. Specify at least one of: start_time, end_time, title, appointment_status, address, assigned_user_id, calendar_id.' };
        }
        const res = await callGHL(`/calendars/events/appointments/${args.event_id}`, 'PUT', updateBody, ghlCreds?.apiKey) as { id?: string; error?: string; message?: string };
        if (res.error || res.message) return { success: false, result: `GHL update appointment error: ${res.error || res.message}` };
        const changed = Object.keys(updateBody).join(', ');
        return { success: true, result: `Appointment ${args.event_id} updated (${changed}).` };
      }

      case 'ghl_trigger_workflow': {
        const res = await callGHL(`/contacts/${args.contact_id}/workflow/${args.workflow_id}`, 'POST', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Workflow ${args.workflow_id} triggered for contact ${args.contact_id}.` };
      }

      // ============ Google Docs ============
      case 'create_google_doc': {
        try {
          const data = await callNativeEdge('google-docs', 'create_document', { title: args.title });
          const doc = data.document as { documentId?: string } | undefined;
          const docId = doc?.documentId;
          if (!docId) return { success: false, result: 'Doc created but no ID returned.' };
          const link = `https://docs.google.com/document/d/${docId}/edit`;
          let result = `Google Doc created: "${args.title}" — ${link}`;
          if (args.content) {
            try {
              await callNativeEdge('google-docs', 'insert_text', { documentId: docId, text: args.content as string, index: 1 });
              result += '\nContent added successfully.';
            } catch (e) { result += `\nDoc created but could not insert content: ${(e as Error).message}`; }
          }
          return { success: true, result };
        } catch (e) { return { success: false, result: `Failed to create doc: ${(e as Error).message}` }; }
      }

      // ============ Google Sheets ============
      case 'create_google_sheet': {
        try {
          const data = await callNativeEdge('google-sheets', 'create_spreadsheet', { title: args.title });
          const sheet = data.spreadsheet as { spreadsheetId?: string; spreadsheetUrl?: string } | undefined;
          const link = sheet?.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheet?.spreadsheetId}/edit`;
          return { success: true, result: `Google Sheet created: "${args.title}" — ${link}` };
        } catch (e) { return { success: false, result: `Failed to create sheet: ${(e as Error).message}` }; }
      }

      case 'read_sheet_data': {
        try {
          const data = await callNativeEdge('google-sheets', 'read_range', {
            spreadsheetId: args.spreadsheet_id, range: (args.range as string) || 'Sheet1',
          });
          const rows = (data.values as string[][]) || [];
          if (!rows.length) return { success: true, result: 'Sheet is empty or range has no data.' };
          return { success: true, result: `Read ${rows.length} rows:\n${rows.slice(0, 50).map(r => r.join(' | ')).join('\n')}${rows.length > 50 ? `\n... and ${rows.length - 50} more rows` : ''}` };
        } catch (e) { return { success: false, result: `Failed to read sheet: ${(e as Error).message}` }; }
      }

      case 'append_sheet_rows': {
        let values: string[][];
        try { values = JSON.parse(args.values as string); } catch { return { success: false, result: 'Invalid values format. Must be a JSON array of arrays.' }; }
        try {
          const data = await callNativeEdge('google-sheets', 'append_rows', {
            spreadsheetId: args.spreadsheet_id, range: (args.range as string) || 'Sheet1', values,
          });
          const updates = data.updates as { updatedRows?: number } | undefined;
          return { success: true, result: `Appended ${updates?.updatedRows || values.length} rows to the spreadsheet.` };
        } catch (e) { return { success: false, result: `Failed to append: ${(e as Error).message}` }; }
      }

      // ============ Google Slides ============
      case 'create_google_presentation': {
        try {
          const data = await callNativeEdge('google-slides', 'create_presentation', { title: args.title });
          const pres = data as { presentationId?: string };
          const link = `https://docs.google.com/presentation/d/${pres.presentationId}/edit`;
          return { success: true, result: `Google Slides presentation created: "${args.title}" — ${link}` };
        } catch (e) { return { success: false, result: `Failed to create presentation: ${(e as Error).message}` }; }
      }

      // ClickUp tools migrated to manifest registry — handled by dispatchTool()


      case 'ghl_list_social_accounts': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/accounts`, 'GET', undefined, ghlCreds?.apiKey) as { accounts?: { id: string; name?: string; type?: string; platform?: string }[] };
        const accounts = (data as unknown as { id: string; name?: string; type?: string; platform?: string }[]) || [];
        const list = Array.isArray(data) ? data : (data.accounts || []);
        if (!list.length) return { success: true, result: 'No social accounts connected.' };
        return { success: true, result: `Social accounts:\n${list.map((a: Record<string, unknown>) => `- ${a.name || a.platform || '?'} (${a.type || a.platform || '?'}) | ID: ${a.id}`).join('\n')}` };
      }

      case 'ghl_list_social_posts': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const body = {
          type: (args.type as string) || 'all', // all | scheduled | posted | failed | in_review
          accountIds: Array.isArray(args.account_ids)
            ? args.account_ids
            : (args.account_ids ? String(args.account_ids).split(',').map(s => s.trim()).filter(Boolean) : []),
          skip: (args.skip as number) || 0,
          limit: (args.limit as number) || 20,
        };
        const data = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/posts/list`, 'POST', body, ghlCreds?.apiKey) as { posts?: { id: string; status?: string; summary?: string; scheduledAt?: string }[]; error?: string; message?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}${data.message ? ' — ' + data.message : ''}` };
        const posts = data.posts || (Array.isArray(data) ? data : []);
        if (!posts.length) return { success: true, result: 'No social posts found. Tip: pass account_ids (comma-separated) from ghl_list_social_accounts to scope the search.' };
        return { success: true, result: `Social posts (${posts.length}):\n${(posts as Record<string, unknown>[]).slice(0, 20).map((p) => `- ${(p.summary as string)?.substring(0, 100) || '(no text)'} | Status: ${p.status || '?'} | ID: ${p.id}`).join('\n')}` };
      }

      case 'ghl_create_social_post': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const postData: Record<string, unknown> = { summary: args.post_text };
        if (args.account_ids) postData.accountIds = (args.account_ids as string).split(',').map(s => s.trim());
        if (args.scheduled_at) postData.scheduledAt = args.scheduled_at;
        if (args.media_urls) postData.media = (args.media_urls as string).split(',').map(url => ({ url: url.trim() }));
        const res = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/posts`, 'POST', postData, ghlCreds?.apiKey) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Social post created${args.scheduled_at ? ' (scheduled)' : ''} (ID: ${res.id || 'created'})` };
      }

      case 'ghl_delete_social_post': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/posts/${args.post_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Social post ${args.post_id} deleted.` };
      }

      case 'ghl_list_products': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/products/?locationId=${GHL_LOCATION_ID}&limit=${(args.limit as number) || 20}`, 'GET', undefined, ghlCreds?.apiKey) as { products?: { id: string; name?: string; price?: number; currency?: string }[] };
        const products = data.products || [];
        if (!products.length) return { success: true, result: 'No products found.' };
        return { success: true, result: `Products (${products.length}):\n${products.map(p => `- ${p.name || 'Untitled'} | $${((p.price || 0) / 100).toFixed(2)} | ID: ${p.id}`).join('\n')}` };
      }

      case 'ghl_get_product': {
        const data = await callGHL(`/products/${args.product_id}`, 'GET', undefined, ghlCreds?.apiKey) as { id?: string; name?: string; description?: string; price?: number; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Product: ${data.name || '?'}\nDescription: ${data.description || 'N/A'}\nPrice: $${((data.price || 0) / 100).toFixed(2)}\nID: ${data.id}` };
      }

      case 'ghl_create_product': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const productData: Record<string, unknown> = { locationId: GHL_LOCATION_ID, name: args.name };
        if (args.description) productData.description = args.description;
        if (args.price) productData.price = args.price;
        const res = await callGHL('/products/', 'POST', productData, ghlCreds?.apiKey) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Product created: "${args.name}" (ID: ${res.id || 'created'})` };
      }

      case 'ghl_update_product': {
        const updateData: Record<string, unknown> = {};
        if (args.name) updateData.name = args.name;
        if (args.description) updateData.description = args.description;
        if (args.price) updateData.price = args.price;
        const res = await callGHL(`/products/${args.product_id}`, 'PUT', updateData, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Product ${args.product_id} updated.` };
      }

      case 'ghl_delete_product': {
        const res = await callGHL(`/products/${args.product_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Product ${args.product_id} deleted.` };
      }

      case 'ghl_list_courses': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/courses/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { courses?: { id: string; title?: string; status?: string }[] };
        const courses = data.courses || [];
        if (!courses.length) return { success: true, result: 'No courses found.' };
        return { success: true, result: `Courses:\n${courses.map(c => `- ${c.title || 'Untitled'} | Status: ${c.status || '?'} | ID: ${c.id}`).join('\n')}` };
      }

      case 'ghl_list_surveys': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/surveys/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { surveys?: { id: string; name: string }[] };
        const surveys = data.surveys || [];
        if (!surveys.length) return { success: true, result: 'No surveys found.' };
        return { success: true, result: `Surveys:\n${surveys.map(s => `- ${s.name} | ID: ${s.id}`).join('\n')}` };
      }

      case 'ghl_get_survey_submissions': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/surveys/submissions?locationId=${GHL_LOCATION_ID}&surveyId=${args.survey_id}&limit=${(args.limit as number) || 20}`, 'GET', undefined, ghlCreds?.apiKey) as { submissions?: { id: string; contactId?: string; createdAt?: string; data?: Record<string, string> }[] };
        const subs = data.submissions || [];
        if (!subs.length) return { success: true, result: 'No survey submissions found.' };
        return { success: true, result: `Survey submissions (${subs.length}):\n${subs.map(s => `- Contact: ${s.contactId || '?'} | ${s.createdAt || ''} | Data: ${JSON.stringify(s.data || {}).substring(0, 200)}`).join('\n')}` };
      }

      case 'ghl_list_blog_sites': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const skip = (args.skip as number) || 0;
        const data = await callGHL(`/blogs/site/all?locationId=${GHL_LOCATION_ID}&limit=${limit}&skip=${skip}`, 'GET', undefined, ghlCreds?.apiKey) as { data?: { _id?: string; id?: string; name?: string; urlSlug?: string }[]; sites?: { _id?: string; id?: string; name?: string }[]; error?: string; message?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}${data.message ? ' — ' + data.message : ''}` };
        const sites = data.data || data.sites || [];
        if (!sites.length) return { success: true, result: 'No blog sites found for this location. Create one in the GHL UI under Sites → Blogs first.' };
        return { success: true, result: `Blog sites (${sites.length}):\n${sites.map(s => `- ${s.name || 'Untitled'} | ID: ${s._id || s.id}`).join('\n')}` };
      }

      case 'ghl_list_blog_posts': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        if (!args.blog_id) return { success: false, result: 'blog_id required. Call ghl_list_blog_sites first to discover blog IDs for this location.' };
        const limit = (args.limit as number) || 20;
        const offset = (args.offset as number) || 0;
        const data = await callGHL(`/blogs/posts/all?locationId=${GHL_LOCATION_ID}&blogId=${encodeURIComponent(String(args.blog_id))}&limit=${limit}&offset=${offset}`, 'GET', undefined, ghlCreds?.apiKey) as { blogPosts?: { _id?: string; id?: string; title?: string; status?: string; createdAt?: string }[]; data?: unknown[]; error?: string; message?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}${data.message ? ' — ' + data.message : ''}` };
        const posts = (data.blogPosts || (data.data as { _id?: string; id?: string; title?: string; status?: string; createdAt?: string }[]) || []);
        if (!posts.length) return { success: true, result: 'No blog posts found in this blog site.' };
        return { success: true, result: `Blog posts (${posts.length}):\n${posts.map(p => `- ${p.title || 'Untitled'} | ${p.status || '?'} | ${p.createdAt || ''} | ID: ${p._id || p.id}`).join('\n')}` };
      }

      case 'ghl_get_blog_post': {
        const data = await callGHL(`/blogs/posts/${args.post_id}`, 'GET', undefined, ghlCreds?.apiKey) as { id?: string; title?: string; content?: string; status?: string; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Blog post: ${data.title || '?'}\nStatus: ${data.status || '?'}\nContent preview: ${(data.content || '').substring(0, 500)}\nID: ${data.id}` };
      }

      case 'ghl_create_blog_post': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        if (!args.blog_id) return { success: false, result: 'blog_id required. Call ghl_list_blog_sites first to discover blog IDs.' };
        const postData: Record<string, unknown> = {
          locationId: GHL_LOCATION_ID,
          blogId: args.blog_id,
          title: args.title,
          rawHTML: args.content, // GHL expects rawHTML for body content
          status: (args.status as string) || 'DRAFT', // DRAFT | PUBLISHED | SCHEDULED | ARCHIVED
        };
        if (args.url_slug) postData.urlSlug = args.url_slug;
        if (args.description) postData.description = args.description;
        if (args.image_url) postData.imageUrl = args.image_url;
        if (args.author) postData.author = args.author;
        if (args.categories) postData.categories = Array.isArray(args.categories) ? args.categories : String(args.categories).split(',').map(s => s.trim());
        if (args.tags) postData.tags = Array.isArray(args.tags) ? args.tags : String(args.tags).split(',').map(s => s.trim());
        if (args.published_at) postData.publishedAt = args.published_at;
        const res = await callGHL('/blogs/posts', 'POST', postData, ghlCreds?.apiKey) as { data?: { _id?: string }; _id?: string; id?: string; error?: string; message?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}${res.message ? ' — ' + res.message : ''}` };
        const newId = res.data?._id || res._id || res.id;
        return { success: true, result: `Blog post created: "${args.title}" (${(args.status as string) || 'DRAFT'}) (ID: ${newId || 'created'})` };
      }

      case 'ghl_update_blog_post': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        if (!args.post_id) return { success: false, result: 'post_id required.' };
        if (!args.blog_id) return { success: false, result: 'blog_id required (the blog site this post belongs to).' };
        const updateData: Record<string, unknown> = {
          locationId: GHL_LOCATION_ID,
          blogId: args.blog_id,
        };
        if (args.title) updateData.title = args.title;
        if (args.content) updateData.rawHTML = args.content;
        if (args.status) updateData.status = args.status;
        if (args.url_slug) updateData.urlSlug = args.url_slug;
        if (args.description) updateData.description = args.description;
        if (args.image_url) updateData.imageUrl = args.image_url;
        if (args.author) updateData.author = args.author;
        if (args.categories) updateData.categories = Array.isArray(args.categories) ? args.categories : String(args.categories).split(',').map(s => s.trim());
        if (args.tags) updateData.tags = Array.isArray(args.tags) ? args.tags : String(args.tags).split(',').map(s => s.trim());
        if (args.published_at) updateData.publishedAt = args.published_at;
        const res = await callGHL(`/blogs/posts/${args.post_id}`, 'PUT', updateData, ghlCreds?.apiKey) as { error?: string; message?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}${res.message ? ' — ' + res.message : ''}` };
        return { success: true, result: `Blog post updated (ID: ${args.post_id})` };
      }

      case 'ghl_delete_blog_post': {
        if (!args.post_id) return { success: false, result: 'post_id required.' };
        const res = await callGHL(`/blogs/posts/${args.post_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string; message?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}${res.message ? ' — ' + res.message : ''}` };
        return { success: true, result: `Blog post deleted (ID: ${args.post_id})` };
      }

      case 'ghl_list_media_files': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/medias/files?altId=${GHL_LOCATION_ID}&altType=location&limit=${(args.limit as number) || 50}`, 'GET', undefined, ghlCreds?.apiKey) as { files?: { id: string; name?: string; url?: string; type?: string }[] };
        const files = data.files || [];
        if (!files.length) return { success: true, result: 'No media files found.' };
        return { success: true, result: `Media files (${files.length}):\n${files.slice(0, 30).map(f => `- ${f.name || 'Untitled'} (${f.type || '?'}) | ID: ${f.id}`).join('\n')}` };
      }

      case 'ghl_upload_media_file': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        if (!args.file_url) return { success: false, result: 'file_url required (public URL of file to upload).' };
        const srcRes = await fetch(args.file_url as string);
        if (!srcRes.ok) return { success: false, result: `Failed to fetch source file: HTTP ${srcRes.status}` };
        const blob = await srcRes.blob();
        const inferredName = (args.file_name as string) || (args.file_url as string).split('/').pop()?.split('?')[0] || 'upload';
        const form = new FormData();
        form.append('file', blob, inferredName);
        form.append('hosted', 'false');
        form.append('name', inferredName);
        if (args.parent_id) form.append('parentId', String(args.parent_id));
        const apiKey = ghlCreds?.apiKey;
        if (!apiKey) return { success: false, result: 'GoHighLevel not connected.' };
        const uploadRes = await fetch(`https://services.leadconnectorhq.com/medias/upload-file?altId=${GHL_LOCATION_ID}&altType=location`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28' },
          body: form,
        });
        const uploadData = await uploadRes.json().catch(() => ({})) as { fileId?: string; id?: string; url?: string; message?: string; error?: string };
        if (!uploadRes.ok) return { success: false, result: `GHL upload error (${uploadRes.status}): ${uploadData.message || uploadData.error || 'unknown'}` };
        return { success: true, result: `Media uploaded: ${inferredName} (ID: ${uploadData.fileId || uploadData.id || '?'})${uploadData.url ? ' | URL: ' + uploadData.url : ''}` };
      }

      case 'ghl_list_companies': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/companies/?locationId=${GHL_LOCATION_ID}&limit=${(args.limit as number) || 20}`, 'GET', undefined, ghlCreds?.apiKey) as { companies?: { id: string; name?: string; email?: string; phone?: string }[] };
        const companies = data.companies || [];
        if (!companies.length) return { success: true, result: 'No companies found.' };
        return { success: true, result: `Companies (${companies.length}):\n${companies.map(c => `- ${c.name || '?'} | ${c.email || ''} | ${c.phone || ''} | ID: ${c.id}`).join('\n')}` };
      }

      case 'ghl_get_company': {
        const data = await callGHL(`/companies/${args.company_id}`, 'GET', undefined, ghlCreds?.apiKey) as { id?: string; name?: string; email?: string; phone?: string; website?: string; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Company: ${data.name || '?'}\nEmail: ${data.email || 'N/A'}\nPhone: ${data.phone || 'N/A'}\nWebsite: ${data.website || 'N/A'}\nID: ${data.id}` };
      }

      case 'ghl_list_links': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/links/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { links?: { id: string; name?: string; url?: string; clicks?: number }[] };
        const links = data.links || [];
        if (!links.length) return { success: true, result: 'No links found.' };
        return { success: true, result: `Links:\n${links.map(l => `- ${l.name || '?'} | ${l.url || ''} | Clicks: ${l.clicks || 0} | ID: ${l.id}`).join('\n')}` };
      }

      case 'ghl_create_link': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL('/links/', 'POST', { locationId: GHL_LOCATION_ID, name: args.name, redirectTo: args.redirectTo }, ghlCreds?.apiKey) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Link created: "${args.name}" → ${args.redirectTo} (ID: ${res.id || 'created'})` };
      }

      case 'ghl_list_businesses': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/businesses/?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { businesses?: { id: string; name?: string; email?: string; phone?: string }[] };
        const businesses = data.businesses || [];
        if (!businesses.length) return { success: true, result: 'No businesses found.' };
        return { success: true, result: `Businesses:\n${businesses.map(b => `- ${b.name || '?'} | ${b.email || ''} | ${b.phone || ''} | ID: ${b.id}`).join('\n')}` };
      }

      case 'ghl_get_business': {
        const data = await callGHL(`/businesses/${args.business_id}`, 'GET', undefined, ghlCreds?.apiKey) as { id?: string; name?: string; email?: string; phone?: string; website?: string; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Business: ${data.name || '?'}\nEmail: ${data.email || 'N/A'}\nPhone: ${data.phone || 'N/A'}\nWebsite: ${data.website || 'N/A'}\nID: ${data.id}` };
      }

      // ============ Edit 1: Previously-unexposed GHL endpoints ============
      case 'ghl_get_conversation': {
        const data = await callGHL(`/conversations/${args.conversation_id}`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Conversation ${args.conversation_id}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_get_invoice': {
        const data = await callGHL(`/invoices/${args.invoice_id}`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Invoice ${args.invoice_id}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_get_opportunity': {
        const data = await callGHL(`/opportunities/${args.opportunity_id}`, 'GET', undefined, ghlCreds?.apiKey) as { opportunity?: Record<string, unknown>; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        const opp = data.opportunity || data;
        return { success: true, result: `Opportunity:\n${JSON.stringify(opp, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_get_social_post': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/posts/${args.post_id}`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Social post ${args.post_id}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_edit_social_post': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const update: Record<string, unknown> = {};
        if (args.summary) update.summary = args.summary;
        if (args.scheduled_at) update.scheduledAt = args.scheduled_at;
        if (args.media_urls) update.media = (args.media_urls as string).split(',').map(u => ({ url: u.trim() }));
        const res = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/posts/${args.post_id}`, 'PUT', update, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Social post ${args.post_id} updated.` };
      }
      case 'ghl_update_link': {
        const update: Record<string, unknown> = {};
        if (args.name) update.name = args.name;
        if (args.redirectTo) update.redirectTo = args.redirectTo;
        const res = await callGHL(`/links/${args.link_id}`, 'PUT', update, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Link ${args.link_id} updated.` };
      }
      case 'ghl_import_courses': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/courses/courses-exporter/public/import`, 'POST', { locationId: GHL_LOCATION_ID, ...(args.payload as Record<string, unknown>) }, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Courses imported.` };
      }
      case 'ghl_create_appointment': {
        const apptData: Record<string, unknown> = {
          calendarId: args.calendar_id,
          contactId: args.contact_id,
          startTime: args.start_time,
        };
        if (args.end_time) apptData.endTime = args.end_time;
        if (args.title) apptData.title = args.title;
        const res = await callGHL(`/calendars/events/appointments`, 'POST', apptData, ghlCreds?.apiKey) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Appointment created (ID: ${res.id || 'created'}).` };
      }

      // ============ Tier A: New GHL endpoints ============
      case 'ghl_delete_opportunity': {
        const res = await callGHL(`/opportunities/${args.opportunity_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Opportunity ${args.opportunity_id} deleted.` };
      }
      case 'ghl_update_opportunity_status': {
        const res = await callGHL(`/opportunities/${args.opportunity_id}/status`, 'PUT', { status: args.status }, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Opportunity ${args.opportunity_id} status set to ${args.status}.` };
      }
      case 'ghl_update_contact_note': {
        const res = await callGHL(`/contacts/${args.contact_id}/notes/${args.note_id}`, 'PUT', { body: args.body }, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Note updated.` };
      }
      case 'ghl_delete_contact_note': {
        const res = await callGHL(`/contacts/${args.contact_id}/notes/${args.note_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Note ${args.note_id} deleted.` };
      }
      case 'ghl_update_contact_task': {
        const update: Record<string, unknown> = {};
        if (args.title !== undefined) update.title = args.title;
        if (args.body !== undefined) update.body = args.body;
        if (args.dueDate !== undefined) update.dueDate = args.dueDate;
        if (args.completed !== undefined) update.completed = args.completed;
        const res = await callGHL(`/contacts/${args.contact_id}/tasks/${args.task_id}`, 'PUT', update, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Task updated.` };
      }
      case 'ghl_complete_contact_task': {
        const res = await callGHL(`/contacts/${args.contact_id}/tasks/${args.task_id}/completed`, 'PUT', { completed: true }, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Task ${args.task_id} marked complete.` };
      }
      case 'ghl_delete_contact_task': {
        const res = await callGHL(`/contacts/${args.contact_id}/tasks/${args.task_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Task ${args.task_id} deleted.` };
      }
      case 'ghl_remove_from_workflow': {
        const res = await callGHL(`/contacts/${args.contact_id}/workflow/${args.workflow_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Contact ${args.contact_id} removed from workflow ${args.workflow_id}.` };
      }

      // ============ Tier B: handlers ============
      case 'ghl_create_custom_field': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const dataType = String(args.dataType || '').toUpperCase();
        const OPTION_TYPES = new Set(['SINGLE_OPTIONS', 'MULTIPLE_OPTIONS', 'RADIO', 'CHECKBOX']);
        const body: Record<string, unknown> = { name: args.name, dataType };
        if (args.position !== undefined) body.position = args.position;
        if (args.model) body.model = args.model;

        // Normalize options for dropdown/radio/checkbox types — coerce every value to a string
        // because GHL API calls .trim() on option values and explodes on non-strings.
        if (OPTION_TYPES.has(dataType)) {
          const rawOpts = args.options;
          if (!Array.isArray(rawOpts) || rawOpts.length === 0) {
            return { success: false, result: `Validation error: dataType "${dataType}" requires a non-empty "options" array (e.g. ["Atlanta, GA","Austin, TX"]).` };
          }
          const normalized: { label: string; value: string; position: number }[] = [];
          for (let i = 0; i < rawOpts.length; i++) {
            const opt = rawOpts[i];
            let label: unknown;
            let value: unknown;
            if (opt && typeof opt === 'object' && !Array.isArray(opt)) {
              label = (opt as Record<string, unknown>).label ?? (opt as Record<string, unknown>).name ?? (opt as Record<string, unknown>).value;
              value = (opt as Record<string, unknown>).value ?? (opt as Record<string, unknown>).label ?? (opt as Record<string, unknown>).name;
            } else {
              label = opt;
              value = opt;
            }
            if (label == null || value == null) {
              return { success: false, result: `Validation error: options[${i}] is missing a label/value.` };
            }
            const labelStr = String(label).trim();
            const valueStr = String(value).trim();
            if (!labelStr || !valueStr) {
              return { success: false, result: `Validation error: options[${i}] label/value cannot be empty after trimming.` };
            }
            normalized.push({ label: labelStr, value: valueStr, position: i + 1 });
          }
          body.options = normalized;
        }

        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/customFields`, 'POST', body, ghlCreds?.apiKey) as { id?: string; customField?: { id?: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        const newId = res.id || res.customField?.id;

        // Self-verify: re-list and confirm the field actually appears. Gives the AI
        // (and Gauntlet) ground truth instead of trusting the POST response alone.
        let verified = false;
        let verifiedSummary = '';
        try {
          const listRes = await callGHL(`/locations/${GHL_LOCATION_ID}/customFields`, 'GET', undefined, ghlCreds?.apiKey) as { customFields?: Array<{ id?: string; name?: string; fieldKey?: string; dataType?: string }>; error?: string };
          if (!listRes.error && Array.isArray(listRes.customFields)) {
            const match = listRes.customFields.find((f) => (newId && f.id === newId) || f.name === args.name);
            if (match) {
              verified = true;
              verifiedSummary = ` Verified live in GHL (id=${match.id}, key=${match.fieldKey || 'n/a'}, type=${match.dataType || dataType}).`;
            }
          }
        } catch (_e) { /* verification is best-effort; do not fail the create */ }

        const optsSuffix = OPTION_TYPES.has(dataType) ? ` with ${(body.options as unknown[]).length} options` : '';
        const baseMsg = `Custom field "${args.name}" created (ID: ${newId || 'created'})${optsSuffix}.`;
        if (verified) return { success: true, result: `${baseMsg}${verifiedSummary}` };
        return { success: true, result: `${baseMsg} Note: post-create verification list did not include this field yet (may be eventual-consistency lag).` };
      }
      case 'ghl_update_custom_field': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.position !== undefined) body.position = args.position;
        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/customFields/${args.field_id}`, 'PUT', body, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Custom field ${args.field_id} updated.` };
      }
      case 'ghl_delete_custom_field': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/customFields/${args.field_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Custom field ${args.field_id} deleted.` };
      }
      case 'ghl_create_custom_value': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/customValues`, 'POST', { name: args.name, value: args.value }, ghlCreds?.apiKey) as { id?: string; customValue?: { id?: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Custom value "${args.name}" created (ID: ${res.id || res.customValue?.id || 'created'}).` };
      }
      case 'ghl_update_custom_value': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.value !== undefined) body.value = args.value;
        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/customValues/${args.value_id}`, 'PUT', body, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Custom value ${args.value_id} updated.` };
      }
      case 'ghl_delete_custom_value': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/customValues/${args.value_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Custom value ${args.value_id} deleted.` };
      }
      case 'ghl_create_tag': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/tags`, 'POST', { name: args.name }, ghlCreds?.apiKey) as { id?: string; tag?: { id?: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Tag "${args.name}" created (ID: ${res.id || res.tag?.id || 'created'}).` };
      }
      case 'ghl_delete_tag': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/tags/${args.tag_id}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Tag ${args.tag_id} deleted.` };
      }
      case 'ghl_list_calendar_groups': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/calendars/groups?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as { groups?: { id: string; name?: string; description?: string }[]; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        const groups = data.groups || [];
        if (!groups.length) return { success: true, result: 'No calendar groups found.' };
        return { success: true, result: `Calendar groups:\n${groups.map(g => `- ${g.name || '?'} | ${g.description || ''} | ID: ${g.id}`).join('\n')}` };
      }
      case 'ghl_list_calendar_resources': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/calendars/resources/${args.resource_type}?locationId=${GHL_LOCATION_ID}`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Calendar ${args.resource_type}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_block_calendar_slot': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const body: Record<string, unknown> = {
          locationId: GHL_LOCATION_ID,
          calendarId: args.calendar_id,
          startTime: args.start_time,
          endTime: args.end_time,
        };
        if (args.title) body.title = args.title;
        const res = await callGHL(`/calendars/events/block-slots`, 'POST', body, ghlCreds?.apiKey) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Calendar slot blocked (ID: ${res.id || 'blocked'}).` };
      }
      case 'ghl_get_user': {
        const data = await callGHL(`/users/${args.user_id}`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `User ${args.user_id}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_create_user': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        const body: Record<string, unknown> = {
          firstName: args.firstName,
          lastName: args.lastName,
          email: args.email,
          password: args.password,
          type: args.type || 'account',
          role: args.role || 'user',
        };
        if (args.phone) body.phone = args.phone;
        if (GHL_LOCATION_ID) body.locationIds = [GHL_LOCATION_ID];
        const res = await callGHL(`/users/`, 'POST', body, ghlCreds?.apiKey) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `User created: ${args.email} (ID: ${res.id || 'created'}).` };
      }
      case 'ghl_update_user': {
        const body: Record<string, unknown> = {};
        if (args.firstName !== undefined) body.firstName = args.firstName;
        if (args.lastName !== undefined) body.lastName = args.lastName;
        if (args.email !== undefined) body.email = args.email;
        if (args.phone !== undefined) body.phone = args.phone;
        if (args.role !== undefined) body.role = args.role;
        const res = await callGHL(`/users/${args.user_id}`, 'PUT', body, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `User ${args.user_id} updated.` };
      }

      // ============ Tier C: handlers ============
      case 'ghl_list_locations': {
        const limit = args.limit || 20;
        const skip = args.skip || 0;
        const data = await callGHL(`/locations/search?limit=${limit}&skip=${skip}`, 'GET', undefined, ghlCreds?.apiKey) as { locations?: { id: string; name?: string; email?: string }[]; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        const locs = data.locations || [];
        if (!locs.length) return { success: true, result: 'No locations found.' };
        return { success: true, result: `Locations (${locs.length}):\n${locs.map(l => `- ${l.name || '?'} | ${l.email || ''} | ID: ${l.id}`).join('\n')}` };
      }
      case 'ghl_get_location': {
        const locId = (args.location_id as string) || (ghlCreds?.locationId || '');
        if (!locId) return { success: false, result: 'No location ID available.' };
        const data = await callGHL(`/locations/${locId}`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Location ${locId}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_update_location': {
        const locId = (args.location_id as string) || (ghlCreds?.locationId || '');
        if (!locId) return { success: false, result: 'No location ID available.' };
        const body: Record<string, unknown> = {};
        for (const k of ['name', 'email', 'phone', 'address', 'city', 'state', 'country', 'postalCode', 'website', 'timezone']) {
          if (args[k] !== undefined) body[k] = args[k];
        }
        const res = await callGHL(`/locations/${locId}`, 'PUT', body, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Location ${locId} updated.` };
      }
      case 'ghl_list_snapshots': {
        const data = await callGHL(`/snapshots/`, 'GET', undefined, ghlCreds?.apiKey) as { snapshots?: { id: string; name?: string; type?: string }[]; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        const snaps = data.snapshots || [];
        if (!snaps.length) return { success: true, result: 'No snapshots found.' };
        return { success: true, result: `Snapshots (${snaps.length}):\n${snaps.map(s => `- ${s.name || '?'} | ${s.type || ''} | ID: ${s.id}`).join('\n')}` };
      }
      case 'ghl_get_order': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/payments/orders/${args.order_id}?altId=${GHL_LOCATION_ID}&altType=location`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Order ${args.order_id}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_get_transaction': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/payments/transactions/${args.transaction_id}?altId=${GHL_LOCATION_ID}&altType=location`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Transaction ${args.transaction_id}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_list_subscriptions': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = args.limit || 20;
        const data = await callGHL(`/payments/subscriptions?altId=${GHL_LOCATION_ID}&altType=location&limit=${limit}`, 'GET', undefined, ghlCreds?.apiKey) as { data?: { _id?: string; id?: string; status?: string; amount?: number }[]; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        const subs = data.data || [];
        if (!subs.length) return { success: true, result: 'No subscriptions found.' };
        return { success: true, result: `Subscriptions (${subs.length}):\n${subs.map(s => `- Status: ${s.status || '?'} | Amount: ${s.amount ?? '?'} | ID: ${s._id || s.id}`).join('\n')}` };
      }
      case 'ghl_get_subscription': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/payments/subscriptions/${args.subscription_id}?altId=${GHL_LOCATION_ID}&altType=location`, 'GET', undefined, ghlCreds?.apiKey) as Record<string, unknown> & { error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Subscription ${args.subscription_id}:\n${JSON.stringify(data, null, 2).substring(0, 2000)}` };
      }
      case 'ghl_list_prices': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = args.limit || 50;
        const data = await callGHL(`/products/${args.product_id}/price?locationId=${GHL_LOCATION_ID}&limit=${limit}`, 'GET', undefined, ghlCreds?.apiKey) as { prices?: { _id?: string; id?: string; name?: string; amount?: number; currency?: string; type?: string }[]; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        const prices = data.prices || [];
        if (!prices.length) return { success: true, result: 'No prices found.' };
        return { success: true, result: `Prices (${prices.length}):\n${prices.map(p => `- ${p.name || '?'} | ${p.amount ?? '?'} ${p.currency || ''} | ${p.type || ''} | ID: ${p._id || p.id}`).join('\n')}` };
      }
      case 'ghl_create_price': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const body: Record<string, unknown> = {
          locationId: GHL_LOCATION_ID,
          name: args.name,
          amount: args.amount,
          currency: args.currency,
          type: args.type,
        };
        if (args.recurringInterval) body.recurring = { interval: args.recurringInterval };
        const res = await callGHL(`/products/${args.product_id}/price`, 'POST', body, ghlCreds?.apiKey) as { _id?: string; id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Price "${args.name}" created (ID: ${res._id || res.id || 'created'}).` };
      }
      case 'ghl_update_price': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const body: Record<string, unknown> = { locationId: GHL_LOCATION_ID };
        if (args.name !== undefined) body.name = args.name;
        if (args.amount !== undefined) body.amount = args.amount;
        const res = await callGHL(`/products/${args.product_id}/price/${args.price_id}`, 'PUT', body, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Price ${args.price_id} updated.` };
      }
      case 'ghl_upload_media_file': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const body: Record<string, unknown> = {
          hosted: args.hosted !== false,
          fileUrl: args.file_url,
          name: args.name,
          altType: 'location',
          altId: GHL_LOCATION_ID,
        };
        if (args.parent_id) body.parentId = args.parent_id;
        const res = await callGHL(`/medias/upload-file`, 'POST', body, ghlCreds?.apiKey) as { fileId?: string; id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Media file "${args.name}" uploaded (ID: ${res.fileId || res.id || 'uploaded'}).` };
      }
      case 'ghl_delete_media_file': {
        const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/medias/${args.file_id}?altType=location&altId=${GHL_LOCATION_ID}`, 'DELETE', undefined, ghlCreds?.apiKey) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Media file ${args.file_id} deleted.` };
      }

      // ============ GHL multi-account + smart search ============
      case 'ghl_list_sub_accounts': {
        const subs = ghlCreds?.subAccounts || [];
        const active = ghlCreds?.locationId || '';
        // Capability groups (kept in sync with _shared/integrations/ghl-scopes.ts)
        const CAP_GROUPS: Array<{ key: string; scopes: string[] }> = [
          { key: 'contacts',      scopes: ['contacts.readonly', 'contacts.write'] },
          { key: 'custom_fields', scopes: ['locations/customFields.readonly', 'locations/customFields.write'] },
          { key: 'opportunities', scopes: ['opportunities.readonly', 'opportunities.write'] },
          { key: 'calendars',     scopes: ['calendars.readonly', 'calendars/events.readonly', 'calendars/events.write'] },
          { key: 'conversations', scopes: ['conversations.readonly', 'conversations/message.readonly', 'conversations/message.write'] },
          { key: 'workflows',     scopes: ['workflows.readonly'] },
          { key: 'campaigns',     scopes: ['campaigns.readonly'] },
          { key: 'invoices',      scopes: ['invoices.readonly', 'invoices.write'] },
          { key: 'payments',      scopes: ['payments/orders.readonly', 'payments/transactions.readonly'] },
          { key: 'forms',         scopes: ['forms.readonly'] },
          { key: 'surveys',       scopes: ['surveys.readonly'] },
          { key: 'social_planner',scopes: ['socialplanner/account.readonly', 'socialplanner/post.readonly', 'socialplanner/post.write'] },
          { key: 'products',      scopes: ['products.readonly', 'products.write'] },
          { key: 'blogs',         scopes: ['blogs/post.readonly', 'blogs/post.write'] },
          { key: 'media',         scopes: ['medias.readonly', 'medias.write'] },
        ];
        const enrich = (s: { id: string; name: string; scopes?: string[]; location_name?: string; disabled?: boolean; last_verified_at?: string }) => {
          const scopeSet = new Set(s.scopes || []);
          const capabilities = CAP_GROUPS
            .filter((g) => g.scopes.some((sc) => scopeSet.has(sc)))
            .map((g) => g.key);
          return {
            id: s.id,
            name: s.name,
            location_name: s.location_name || null,
            active: s.id === active,
            disabled: s.disabled === true,
            scopes_count: (s.scopes || []).length,
            capabilities,
            last_verified_at: s.last_verified_at || null,
          };
        };
        if (subs.length === 0) {
          return {
            success: true,
            result: JSON.stringify({
              sub_accounts: active ? [{ id: active, name: 'Primary', active: true, disabled: false, scopes_count: 0, capabilities: [], location_name: null, last_verified_at: null }] : [],
              note: 'No sub-accounts configured. Add more in Integrations → Go High Level.',
            }),
          };
        }
        return {
          success: true,
          result: JSON.stringify({ sub_accounts: subs.map(enrich) }),
        };
      }
      case 'ghl_set_active_sub_account': {
        const subs = ghlCreds?.subAccounts || [];
        const wantId = (args.location_id as string | undefined)?.trim();
        const wantName = (args.name as string | undefined)?.trim().toLowerCase();
        if (!wantId && !wantName) return { success: false, result: 'Provide either location_id or name.' };
        let match = wantId ? subs.find((s) => s.id === wantId) : undefined;
        if (!match && wantName) {
          match = subs.find((s) => s.name.toLowerCase() === wantName)
            || subs.find((s) => s.name.toLowerCase().includes(wantName));
        }
        if (!match && wantId && subs.length === 0) {
          // No configured sub_accounts list — accept the raw id as best effort.
          if (ghlCreds) ghlCreds.locationId = wantId;
          return { success: true, result: `Active GHL location set to ${wantId} (no sub-account roster configured).` };
        }
        if (!match) {
          return {
            success: false,
            result: `No matching sub-account. Available: ${subs.map((s) => s.name).join(', ') || '(none)'}`,
          };
        }
        if (match.disabled === true) {
          return {
            success: false,
            result: `"${match.name}" is currently disconnected. Re-enable it in Integrations → Go High Level first, or pick another account.`,
          };
        }
        if (ghlCreds) {
          ghlCreds.locationId = match.id;
          if (match.api_key) ghlCreds.apiKey = match.api_key;
        }
        // Persist to session memory so the choice survives across messages in this conversation.
        try {
          const sid = (globalThis as Record<string, unknown>).__currentSessionId as string | undefined;
          const uid = (globalThis as Record<string, unknown>).__currentUserId as string | undefined;
          if (sid && uid) {
            const { createClient: ccSess } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
            const adminSess = ccSess(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
            await adminSess.from('chat_sessions')
              .update({ active_ghl_location_id: match.id })
              .eq('id', sid).eq('user_id', uid);
          }
        } catch (e) { console.error('[GHL] session-memory persist failed:', e); }
        return { success: true, result: `Active GHL sub-account is now "${match.name}" (${match.id}). Remembered for this conversation.` };
      }
      case 'ghl_set_default_sub_account': {
        const subs = ghlCreds?.subAccounts || [];
        const wantId = (args.location_id as string | undefined)?.trim();
        const wantName = (args.name as string | undefined)?.trim().toLowerCase();
        if (!wantId && !wantName) return { success: false, result: 'Provide either location_id or name.' };
        let match = wantId ? subs.find((s) => s.id === wantId) : undefined;
        if (!match && wantName) {
          match = subs.find((s) => s.name.toLowerCase() === wantName)
            || subs.find((s) => s.name.toLowerCase().includes(wantName));
        }
        if (!match) {
          return {
            success: false,
            result: `No matching sub-account. Available: ${subs.map((s) => s.name).join(', ') || '(none)'}`,
          };
        }
        if (match.disabled === true) {
          return {
            success: false,
            result: `"${match.name}" is currently disconnected. Re-enable it in Integrations → Go High Level before setting it as the default.`,
          };
        }
        try {
          const uid = (globalThis as Record<string, unknown>).__currentUserId as string | undefined;
          if (!uid) return { success: false, result: 'No authenticated user; cannot save default.' };
          const { createClient: ccDef } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminDef = ccDef(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          const { error } = await adminDef.from('profiles')
            .update({ default_ghl_location_id: match.id })
            .eq('user_id', uid);
          if (error) return { success: false, result: `Failed to save default: ${error.message}` };
          // Also apply for the rest of this turn.
          if (ghlCreds) {
            ghlCreds.locationId = match.id;
            if (match.api_key) ghlCreds.apiKey = match.api_key;
          }
          return { success: true, result: `"${match.name}" is now your permanent default GoHighLevel sub-account. Every new chat will start with it.` };
        } catch (e) {
          return { success: false, result: `Failed to save default: ${(e as Error).message}` };
        }
      }
      case 'ghl_check_capability': {
        const toolName2 = (args.tool_name as string | undefined)?.trim();
        if (!toolName2) return { success: false, result: 'tool_name is required.' };
        const subs = ghlCreds?.subAccounts || [];
        const wantId = (args.location_id as string | undefined)?.trim() || ghlCreds?.locationId || '';
        const target = subs.find((s) => s.id === wantId);
        const required = GHL_TOOL_REQUIRED_SCOPES[toolName2] || [];
        const stored = target?.scopes || [];
        const storedSet = new Set(stored);
        const missing = required.filter((s) => !storedSet.has(s));
        // No required scopes mapped → permissive
        if (required.length === 0) {
          return { success: true, result: JSON.stringify({
            allowed: true, missing_scopes: [], stored_scopes_count: stored.length,
            recommendation: `${toolName2} has no scope requirements on file — proceed.`,
          }) };
        }
        // Unknown scopes (legacy account never verified) → permissive but warn
        if (stored.length === 0) {
          return { success: true, result: JSON.stringify({
            allowed: true, missing_scopes: [], stored_scopes_count: 0,
            recommendation: `Scopes for "${target?.name || wantId}" are not on file. Re-sync the account in Integrations → Go High Level to enable scope-aware checks. Proceeding optimistically.`,
          }) };
        }
        if (missing.length === 0) {
          return { success: true, result: JSON.stringify({
            allowed: true, missing_scopes: [], stored_scopes_count: stored.length,
            recommendation: `"${target?.name || wantId}" has all required scopes for ${toolName2}.`,
          }) };
        }
        return { success: true, result: JSON.stringify({
          allowed: false, missing_scopes: missing, stored_scopes_count: stored.length,
          recommendation: `"${target?.name || wantId}" is missing scope${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Edit the Private Integration token in GoHighLevel → Settings → Private Integrations, add the missing scope${missing.length > 1 ? 's' : ''}, then re-sync from Integrations → Go High Level.`,
        }) };
      }
      case 'ghl_smart_search': {
        const query = (args.query as string | undefined)?.trim();
        if (!query) return { success: false, result: 'query is required.' };
        const subs = ghlCreds?.subAccounts || [];
        const explicit = (args.location_id as string | undefined)?.trim();
        const targetSub = explicit ? subs.find((s) => s.id === explicit) : undefined;
        const locId = explicit || ghlCreds?.locationId || '';
        const apiKey = (targetSub?.api_key) || ghlCreds?.apiKey;
        if (!locId) return { success: false, result: 'GoHighLevel location ID not configured.' };
        if (!apiKey) return { success: false, result: 'GoHighLevel not connected.' };
        const types = (Array.isArray(args.types) && args.types.length > 0
          ? args.types as string[]
          : ['contacts', 'opportunities', 'conversations', 'appointments']);
        const limit = Math.max(1, Math.min(20, (args.limit as number) || 5));
        const enc = encodeURIComponent(query);

        type Hit = { type: string; id: string; title: string; subtitle?: string; snippet?: string; raw?: unknown };
        const tasks: Promise<{ type: string; hits: Hit[] }>[] = [];

        if (types.includes('contacts')) {
          tasks.push((async () => {
            const data = await callGHL(`/contacts/?locationId=${locId}&query=${enc}&limit=${limit}`, 'GET', undefined, apiKey) as { contacts?: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string }[] };
            const hits: Hit[] = (data.contacts || []).map((c) => ({
              type: 'contact', id: c.id,
              title: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || c.id,
              subtitle: c.email || c.phone, raw: c,
            }));
            return { type: 'contacts', hits };
          })());
        }
        if (types.includes('opportunities')) {
          tasks.push((async () => {
            const data = await callGHL(`/opportunities/search?location_id=${locId}&q=${enc}&limit=${limit}`, 'GET', undefined, apiKey) as { opportunities?: { id: string; name: string; monetaryValue?: number; status?: string; pipelineStageId?: string }[] };
            const hits: Hit[] = (data.opportunities || []).map((o) => ({
              type: 'opportunity', id: o.id, title: o.name || o.id,
              subtitle: o.status ? `${o.status}${o.monetaryValue ? ` · $${o.monetaryValue}` : ''}` : undefined,
              raw: o,
            }));
            return { type: 'opportunities', hits };
          })());
        }
        if (types.includes('conversations')) {
          tasks.push((async () => {
            const data = await callGHL(`/conversations/search?locationId=${locId}&query=${enc}&limit=${limit}`, 'GET', undefined, apiKey) as { conversations?: { id: string; contactId?: string; type?: string; lastMessageDate?: string; fullName?: string; lastMessageBody?: string }[] };
            const hits: Hit[] = (data.conversations || []).map((c) => ({
              type: 'conversation', id: c.id, title: c.fullName || c.contactId || c.id,
              subtitle: c.type, snippet: c.lastMessageBody, raw: c,
            }));
            return { type: 'conversations', hits };
          })());
        }
        if (types.includes('appointments')) {
          tasks.push((async () => {
            // GHL has no global appointment search; use contact-name search → fall back gracefully.
            const data = await callGHL(`/contacts/?locationId=${locId}&query=${enc}&limit=${limit}`, 'GET', undefined, apiKey) as { contacts?: { id: string }[] };
            const contactIds = (data.contacts || []).slice(0, 3).map((c) => c.id);
            const hits: Hit[] = [];
            for (const cid of contactIds) {
              try {
                const ev = await callGHL(`/contacts/${cid}/appointments`, 'GET', undefined, apiKey) as { events?: { id: string; title?: string; startTime?: string; status?: string }[] };
                for (const e of (ev.events || []).slice(0, limit)) {
                  hits.push({ type: 'appointment', id: e.id, title: e.title || 'Appointment', subtitle: e.startTime, raw: e });
                }
              } catch { /* ignore per-contact failure */ }
            }
            return { type: 'appointments', hits: hits.slice(0, limit) };
          })());
        }

        const settled = await Promise.allSettled(tasks);
        const results: Hit[] = [];
        const errors: { type: string; message: string }[] = [];
        settled.forEach((r, i) => {
          if (r.status === 'fulfilled') results.push(...r.value.hits);
          else errors.push({ type: types[i], message: (r.reason as Error)?.message || String(r.reason) });
        });
        return {
          success: true,
          result: JSON.stringify({
            query,
            location_id: locId,
            sub_account: targetSub?.name,
            count: results.length,
            results,
            errors: errors.length ? errors : undefined,
          }),
        };
      }

      // ============ GSC / SEO Intelligence tool handlers (native edge) ============
      case 'gsc_list_sites': {
        try {
          const data = await callNativeEdge('google-search-console', 'list_sites', {}) as { siteEntry?: { siteUrl: string; permissionLevel?: string }[] };
          const sites = data.siteEntry || [];
          if (!sites.length) return { success: true, result: 'No sites found in Google Search Console.' };
          return { success: true, result: `GSC Properties (${sites.length}):\n${sites.map(s => `- ${s.siteUrl} (${s.permissionLevel || 'unknown permission'})`).join('\n')}` };
        } catch (e) { return { success: false, result: `GSC error: ${(e as Error).message}` }; }
      }

      case 'gsc_query': {
        const dims = (args.dimensions as string || 'query').split(',').map(d => d.trim());
        const rowLimit = Math.min((args.row_limit as number) || 100, 1000);
        const request: Record<string, unknown> = {
          startDate: args.start_date,
          endDate: args.end_date,
          dimensions: dims,
          rowLimit,
        };
        if (args.aggregation_type) request.aggregationType = args.aggregation_type;
        if (args.filters) { try { request.dimensionFilterGroups = [{ filters: JSON.parse(args.filters as string) }]; } catch { /* ignore bad filter JSON */ } }
        let data: { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] };
        try {
          data = await callNativeEdge('google-search-console', 'search_analytics', { siteUrl: args.site_url, request }) as typeof data;
        } catch (e) { return { success: false, result: `GSC query error: ${(e as Error).message}` }; }
        const rows = data.rows || [];
        if (!rows.length) return { success: true, result: `No data found for ${args.site_url} between ${args.start_date} and ${args.end_date} with dimensions [${dims.join(', ')}].` };
        const totals = rows.reduce((a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }), { clicks: 0, impressions: 0 });
        const avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions * 100).toFixed(2) : '0';
        const avgPos = rows.length > 0 ? (rows.reduce((s, r) => s + r.position, 0) / rows.length).toFixed(1) : '0';
        let result = `**GSC Query Results for ${args.site_url}**\n`;
        result += `Period: ${args.start_date} to ${args.end_date} | Dimensions: ${dims.join(', ')}\n`;
        result += `**Totals:** ${totals.clicks} clicks, ${totals.impressions} impressions, ${avgCtr}% CTR, avg pos ${avgPos}\n\n`;
        result += `**Data (${rows.length} rows):**\n`;
        for (const row of rows.slice(0, 100)) {
          const keyStr = row.keys.join(' | ');
          result += `- ${keyStr}: ${row.clicks} clicks, ${row.impressions} imp, ${(row.ctr * 100).toFixed(1)}% CTR, pos ${row.position.toFixed(1)}\n`;
        }
        if (rows.length > 100) result += `\n... and ${rows.length - 100} more rows`;
        // Include full data as JSON for snapshot saving
        result += `\n\n[SNAPSHOT_DATA]${JSON.stringify({ rows: rows.slice(0, 500), totals: { clicks: totals.clicks, impressions: totals.impressions, ctr: parseFloat(avgCtr), position: parseFloat(avgPos) } })}[/SNAPSHOT_DATA]`;
        return { success: true, result };
      }

      case 'gsc_save_snapshot': {
        try {
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          if (!serviceRoleKey || !supabaseUrl) return { success: false, result: 'Database configuration missing.' };
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminClient = createClient(supabaseUrl, serviceRoleKey);
          // We need the user ID — try to get from auth header context
          const dims = (args.dimensions as string || '').split(',').map(d => d.trim()).filter(Boolean);
          let dataRows = [];
          let totalsObj = {};
          try { dataRows = JSON.parse(args.data as string); } catch { /* */ }
          try { totalsObj = JSON.parse((args.totals as string) || '{}'); } catch { /* */ }
          const { error } = await adminClient.from('seo_snapshots').insert({
            user_id: '00000000-0000-0000-0000-000000000000', // Will be replaced by RLS auth
            site_url: args.site_url,
            snapshot_date: new Date().toISOString().split('T')[0],
            date_range_start: args.start_date,
            date_range_end: args.end_date,
            dimensions: dims,
            data: dataRows,
            totals: totalsObj,
          });
          if (error) return { success: false, result: `Failed to save snapshot: ${error.message}` };
          return { success: true, result: `SEO snapshot saved for ${args.site_url} (${args.start_date} to ${args.end_date}). You can compare this with future data using gsc_compare_snapshots.` };
        } catch (e) { return { success: false, result: `Snapshot save error: ${e instanceof Error ? e.message : 'Unknown'}` }; }
      }

      case 'gsc_compare_snapshots': {
        try {
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          if (!serviceRoleKey || !supabaseUrl) return { success: false, result: 'Database configuration missing.' };
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminClient = createClient(supabaseUrl, serviceRoleKey);
          const limit = (args.limit as number) || 5;
          const { data, error } = await adminClient.from('seo_snapshots')
            .select('*')
            .eq('site_url', args.site_url)
            .order('snapshot_date', { ascending: false })
            .limit(limit);
          if (error) return { success: false, result: `Failed to load snapshots: ${error.message}` };
          if (!data?.length) return { success: true, result: `No saved snapshots found for ${args.site_url}. Run a gsc_query first, then use gsc_save_snapshot to persist it.` };
          let result = `**Saved SEO Snapshots for ${args.site_url}** (${data.length} found)\n\n`;
          for (const snap of data) {
            const totals = snap.totals as Record<string, number> || {};
            result += `📊 **${snap.snapshot_date}** (${snap.date_range_start} → ${snap.date_range_end})\n`;
            result += `   Dimensions: ${(snap.dimensions || []).join(', ') || 'N/A'}\n`;
            result += `   Totals: ${totals.clicks || 0} clicks, ${totals.impressions || 0} imp, ${totals.ctr || 0}% CTR, pos ${totals.position || 0}\n`;
            const rows = (snap.data as Record<string, unknown>[]) || [];
            result += `   Data rows: ${rows.length}\n\n`;
          }
          result += `Use this data to compare with a fresh gsc_query for the same date range or a new period.`;
          return { success: true, result };
        } catch (e) { return { success: false, result: `Snapshot comparison error: ${e instanceof Error ? e.message : 'Unknown'}` }; }
      }

      // ============ Search Atlas (SEO intelligence) ============
      case 'searchatlas_audit_site':
      case 'searchatlas_site_explorer':
      case 'searchatlas_keyword_research':
      case 'searchatlas_serp_snapshot':
      case 'searchatlas_backlinks_overview':
      case 'searchatlas_backlinks_list':
      case 'searchatlas_list_projects':
      case 'searchatlas_rank_tracker': {
        const actionMap: Record<string, string> = {
          searchatlas_audit_site: 'audit_site',
          searchatlas_site_explorer: 'site_explorer',
          searchatlas_keyword_research: 'keyword_research',
          searchatlas_serp_snapshot: 'serp_snapshot',
          searchatlas_backlinks_overview: 'backlinks_overview',
          searchatlas_backlinks_list: 'backlinks_list',
          searchatlas_list_projects: 'list_projects',
          searchatlas_rank_tracker: 'rank_tracker_keywords',
        };
        try {
          const data = await callNativeEdge('search-atlas', actionMap[toolName], args as Record<string, unknown>);
          return { success: true, result: `**Search Atlas (${actionMap[toolName]}):**\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 6000)}\n\`\`\`` };
        } catch (e) {
          return { success: false, result: `Search Atlas error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }
      case 'web_search_google': {
        try {
          if (!LOVABLE_API_KEY) return { success: false, result: 'Search API not configured.' };
          const keyword = args.keyword as string;
          const numResults = Math.min((args.num_results as number) || 10, 20);
          // Use the Lovable AI Gateway to perform a web search via the AI model
          const searchRes = await fetch('https://api.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'You are a search results formatter. Return ONLY a JSON array of the top organic search results for the given query. Each result should have: {position: number, title: string, url: string, snippet: string}. No commentary, just the JSON array.' },
                { role: 'user', content: `What are the current top ${numResults} Google search results for: "${keyword}"` },
              ],
              max_completion_tokens: 2000,
            }),
          });
          if (!searchRes.ok) {
            const errBody = await searchRes.text().catch(() => '');
            console.error(`[web_search_google] Gateway ${searchRes.status}: ${errBody.slice(0, 400)}`);
            return { success: false, result: `Search failed: HTTP ${searchRes.status}` };
          }
          const searchData = await searchRes.json();
          const content = searchData.choices?.[0]?.message?.content || '';
          return { success: true, result: `**Live Google SERP Results for "${keyword}":**\n\n${content}\n\nCross-reference these positions with GSC data to validate ranking accuracy.` };
        } catch (e) { return { success: false, result: `Search error: ${e instanceof Error ? e.message : 'Unknown'}` }; }
      }

      case 'generate_image':
      case 'edit_image': {
        try {
          const userIdForImg = (args as Record<string, unknown>).__user_id as string;
          if (!userIdForImg) {
            return { success: false, result: 'Authentication required for image generation.' };
          }
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          if (!supabaseUrl || !serviceKey) return { success: false, result: 'Image service not configured.' };
          const prompt = args.prompt as string;
          const imageUrl = args.image_url as string | undefined;
          const modelOverride = args.model as string | undefined;
          if (!prompt) return { success: false, result: 'prompt is required.' };
          if (toolName === 'edit_image' && !imageUrl) {
            return { success: false, result: 'image_url is required for edit_image.' };
          }
          const resp = await fetch(`${supabaseUrl}/functions/v1/image-gen`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt,
              model: modelOverride,
              inputImageUrl: toolName === 'edit_image' ? imageUrl : undefined,
              userId: userIdForImg,
            }),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            return { success: false, result: `Image ${toolName === 'edit_image' ? 'edit' : 'generation'} failed: ${resp.status} ${errText}` };
          }
          const data = await resp.json();
          if (!data?.url) return { success: false, result: 'Image service returned no URL.' };
          return {
            success: true,
            result: `Image ${toolName === 'edit_image' ? 'edited' : 'generated'} with ${data.model}. URL: ${data.url}\n\nDisplay it to the user as: ![](${data.url})`,
          };
        } catch (e) {
          return { success: false, result: `Image error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'generate_video': {
        try {
          const userIdForVid = (args as Record<string, unknown>).__user_id as string;
          if (!userIdForVid) {
            return { success: false, result: 'Authentication required for video generation.' };
          }
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          if (!supabaseUrl || !serviceKey) return { success: false, result: 'Video service not configured.' };
          const prompt = args.prompt as string;
          if (!prompt) return { success: false, result: 'prompt is required.' };
          const resp = await fetch(`${supabaseUrl}/functions/v1/video-gen`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt,
              duration: args.duration as number | undefined,
              aspect_ratio: args.aspect_ratio as string | undefined,
              userId: userIdForVid,
            }),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            return { success: false, result: `Video generation failed: ${resp.status} ${errText}` };
          }
          const data = await resp.json();
          if (data?.pending && data?.request_id) {
            return {
              success: true,
              result: `Video generation queued via Higgsfield (request_id: ${data.request_id}). Poll with higgsfield_get_job_status to retrieve when ready.`,
            };
          }
          if (!data?.url) return { success: false, result: 'Video service returned no URL.' };
          return {
            success: true,
            result: `Video generated with ${data.model}. URL: ${data.url}\n\nDisplay it to the user as: <video controls src="${data.url}"></video>`,
          };
        } catch (e) {
          return { success: false, result: `Video error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'save_memory': {
        try {
          const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');
          if (!OPENAI_KEY) return { success: false, result: 'Embedding API not configured.' };
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          if (!serviceRoleKey || !supabaseUrl) return { success: false, result: 'Database not configured.' };

          const memoryContent = args.content as string;
          const memorySummary = args.summary as string;
          const memoryType = (args.memory_type as string) || 'fact';
          const salience = (args.salience as number) || 0.6;

          // Get user ID from the request auth context (passed via closure)
          // We'll use the wisdomUserId that was resolved earlier in the main handler
          // For now, use service role to query — the tool is only called within authenticated sessions
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminClient = createClient(supabaseUrl, serviceRoleKey);

          // Generate embedding for deduplication and storage
          const embRes = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'text-embedding-3-small', input: memoryContent }),
          });
          if (!embRes.ok) return { success: false, result: 'Failed to generate embedding.' };
          const embData = await embRes.json();
          const embedding = embData.data[0].embedding;

          // Deduplication: check for highly similar existing memories
          // We need the user_id — extract from the tool call context
          // The wisdomUserId is captured in the outer scope of the main handler
          // We pass it through via a closure variable set before the tool loop
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated for memory storage.' };

          const { data: similar } = await adminClient.rpc('match_wisdom_memories', {
            query_embedding: JSON.stringify(embedding),
            match_threshold: 0.9,
            match_count: 1,
            filter_user_id: userId,
            filter_memory_type: null,
          });

          if (similar && similar.length > 0) {
            // Update existing memory: bump recurrence_count and confidence
            const existing = similar[0];
            await adminClient.from('wisdom_memories').update({
              recurrence_count: (existing.recurrence_count || 1) + 1,
              confidence: Math.min((existing.confidence || 0.8) + 0.05, 1.0),
              content: memoryContent, // Update with latest wording
              summary: memorySummary,
              salience: Math.max(existing.salience || 0.5, salience),
              updated_at: new Date().toISOString(),
              last_accessed_at: new Date().toISOString(),
            }).eq('id', existing.id);
            console.log(`[save_memory] Deduplicated — updated existing memory ${existing.id} (recurrence: ${(existing.recurrence_count || 1) + 1})`);
            return { success: true, result: `Memory updated (reinforced existing): "${memorySummary}"` };
          }

          // Insert new memory
          const { error } = await adminClient.from('wisdom_memories').insert({
            user_id: userId,
            memory_type: memoryType,
            content: memoryContent,
            summary: memorySummary,
            embedding: JSON.stringify(embedding),
            salience,
            confidence: 0.85,
          });
          if (error) {
            console.error('[save_memory] Insert error:', error);
            return { success: false, result: `Failed to save memory: ${error.message}` };
          }
          console.log(`[save_memory] New memory saved: "${memorySummary}" (type: ${memoryType})`);
          return { success: true, result: `Memory saved: "${memorySummary}"` };
        } catch (e) {
          console.error('[save_memory] Error:', e);
          return { success: false, result: `Memory error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      case 'search_wisdom_memories': {
        try {
          const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');
          if (!OPENAI_KEY) return { success: false, result: 'Embedding API not configured.' };
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          if (!serviceRoleKey || !supabaseUrl) return { success: false, result: 'Database not configured.' };

          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated for memory search.' };

          const query = String(args.query || '').trim();
          if (!query) return { success: false, result: 'query is required' };
          const memoryType = (args.memory_type as string) || null;
          const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 20);

          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminClient = createClient(supabaseUrl, serviceRoleKey);

          const embRes = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
          });
          if (!embRes.ok) return { success: false, result: 'Failed to generate query embedding.' };
          const embData = await embRes.json();
          const embedding = embData.data[0].embedding;

          const { data, error } = await adminClient.rpc('match_wisdom_memories', {
            query_embedding: JSON.stringify(embedding),
            match_threshold: 0.5,
            match_count: limit,
            filter_user_id: userId,
            filter_memory_type: memoryType,
          });
          if (error) {
            console.error('[search_wisdom_memories] error:', error);
            return { success: false, result: `Memory search failed: ${error.message}` };
          }
          const rows = (data ?? []) as Array<{ id: string; memory_type: string; summary: string; content: string; salience: number; recurrence_count: number; similarity: number }>;
          if (rows.length === 0) {
            return { success: true, result: `No matching memories found for "${query}"${memoryType ? ` (type=${memoryType})` : ''}.` };
          }
          const formatted = rows.map((r, i) =>
            `${i + 1}. [${r.memory_type}] ${r.summary} (sim ${r.similarity.toFixed(2)}, seen ${r.recurrence_count}x)\n   ${r.content}`,
          ).join('\n');
          console.log(`[search_wisdom_memories] ${rows.length} matches for "${query}"`);
          return { success: true, result: `Found ${rows.length} memory match(es):\n${formatted}` };
        } catch (e) {
          console.error('[search_wisdom_memories] Error:', e);
          return { success: false, result: `Memory search error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      case 'create_routine': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { data, error } = await admin.from('scheduled_routines').insert({
            user_id: userId,
            name: args.name as string,
            description: (args.description as string) || null,
            prompt: args.prompt as string,
            cron_expression: args.cron_expression as string,
            delivery_channel: (args.delivery_channel as string) || 'in_app',
            active: true,
          }).select('id, name, cron_expression').single();
          if (error) return { success: false, result: `Failed: ${error.message}` };
          return { success: true, result: `Routine "${data.name}" created (id: ${data.id}). Schedule: ${data.cron_expression} UTC. It will fire automatically and the result will appear in your Routines page.` };
        } catch (e) {
          return { success: false, result: `Routine error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      case 'list_routines': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { data, error } = await admin.from('scheduled_routines')
            .select('id, name, cron_expression, active, last_run_at, last_run_status, run_count')
            .eq('user_id', userId).order('created_at', { ascending: false });
          if (error) return { success: false, result: `Failed: ${error.message}` };
          if (!data || data.length === 0) return { success: true, result: 'No routines yet. Say "create a routine to..." to make one.' };
          const lines = data.map((r) => `• ${r.name} — ${r.cron_expression} UTC — ${r.active ? 'active' : 'paused'} — runs: ${r.run_count}${r.last_run_status ? ` (last: ${r.last_run_status})` : ''} [id: ${r.id}]`);
          return { success: true, result: `Your routines:\n${lines.join('\n')}` };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      case 'toggle_routine': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { error } = await admin.from('scheduled_routines')
            .update({ active: args.active as boolean })
            .eq('id', args.routine_id as string).eq('user_id', userId);
          if (error) return { success: false, result: `Failed: ${error.message}` };
          return { success: true, result: `Routine ${args.active ? 'resumed' : 'paused'}.` };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      case 'delete_routine': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { error } = await admin.from('scheduled_routines')
            .delete().eq('id', args.routine_id as string).eq('user_id', userId);
          if (error) return { success: false, result: `Failed: ${error.message}` };
          return { success: true, result: `Routine deleted.` };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      case 'run_routine_now': {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          // Fire and forget — don't block tool response on the full chain
          fetch(`${supabaseUrl}/functions/v1/scheduled-routines?mode=run&routine_id=${args.routine_id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${serviceRoleKey}` },
          }).catch((e) => console.error('[run_routine_now]', e));
          return { success: true, result: `Routine triggered. Check the Routines page in a moment for the run output.` };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      case 'add_standing_order': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { data, error } = await admin.from('standing_orders').insert({
            user_id: userId,
            rule: args.rule as string,
            scope: (args.scope as string) || 'global',
            priority: (args.priority as number) || 5,
          }).select('id').single();
          if (error) return { success: false, result: `Failed: ${error.message}` };
          return { success: true, result: `Standing order saved (id: ${data?.id}). I will obey this from now on.` };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'remove_standing_order': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { error } = await admin.from('standing_orders')
            .update({ active: false })
            .eq('id', args.order_id as string)
            .eq('user_id', userId);
          if (error) return { success: false, result: `Failed: ${error.message}` };
          return { success: true, result: 'Standing order removed.' };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'update_standing_order': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const oldMatch = String(args.old_rule_match || '').trim();
          const newRule = String(args.new_rule || '').trim();
          if (!oldMatch) return { success: false, result: 'old_rule_match is required.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          // Find the best-matching active rule via case-insensitive ILIKE on any keyword from old_match
          const { data: candidates, error: findErr } = await admin
            .from('standing_orders')
            .select('id, rule, scope, priority')
            .eq('user_id', userId)
            .eq('active', true)
            .ilike('rule', `%${oldMatch}%`)
            .limit(1);
          if (findErr) return { success: false, result: `Lookup failed: ${findErr.message}` };
          const oldRow = candidates?.[0];
          if (!oldRow) {
            return { success: false, result: `No active rule matched "${oldMatch}". Use add_standing_order if it should be brand new.` };
          }
          const nowIso = new Date().toISOString();
          let newId: string | null = null;
          if (newRule) {
            const { data: inserted, error: insErr } = await admin.from('standing_orders').insert({
              user_id: userId,
              rule: newRule,
              scope: (args.scope as string) || oldRow.scope || 'global',
              priority: oldRow.priority || 5,
            }).select('id').single();
            if (insErr) return { success: false, result: `Insert failed: ${insErr.message}` };
            newId = inserted?.id || null;
          }
          const { error: updErr } = await admin.from('standing_orders')
            .update({ active: false, superseded_at: nowIso, superseded_by: newId })
            .eq('id', oldRow.id)
            .eq('user_id', userId);
          if (updErr) return { success: false, result: `Supersede failed: ${updErr.message}` };
          if (newRule) {
            return { success: true, result: `Replaced rule. Previously: "${oldRow.rule}". Now: "${newRule}". Confirm this change to the user.` };
          }
          return { success: true, result: `Deactivated rule: "${oldRow.rule}". Confirm to the user.` };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'update_memory': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const oldMatch = String(args.old_summary_match || '').trim();
          const newContent = String(args.new_content || '').trim();
          if (!oldMatch || !newContent) return { success: false, result: 'old_summary_match and new_content are required.' };
          const memoryType = (args.memory_type as string) || 'preference';
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          // Match against summary OR content, only non-superseded rows
          const { data: candidates, error: findErr } = await admin
            .from('wisdom_memories')
            .select('id, summary, content, memory_type, salience, confidence')
            .eq('user_id', userId)
            .is('superseded_at', null)
            .or(`summary.ilike.%${oldMatch}%,content.ilike.%${oldMatch}%`)
            .limit(1);
          if (findErr) return { success: false, result: `Lookup failed: ${findErr.message}` };
          const oldRow = candidates?.[0];
          if (!oldRow) {
            return { success: false, result: `No memory matched "${oldMatch}". Use save_memory if this is brand new.` };
          }
          const { data: inserted, error: insErr } = await admin.from('wisdom_memories').insert({
            user_id: userId,
            memory_type: memoryType,
            content: newContent,
            summary: newContent.length > 120 ? newContent.slice(0, 117) + '…' : newContent,
            salience: oldRow.salience ?? 0.6,
            confidence: oldRow.confidence ?? 0.85,
          }).select('id').single();
          if (insErr) return { success: false, result: `Insert failed: ${insErr.message}` };
          const { error: updErr } = await admin.from('wisdom_memories')
            .update({ superseded_at: new Date().toISOString(), superseded_by: inserted?.id || null })
            .eq('id', oldRow.id)
            .eq('user_id', userId);
          if (updErr) return { success: false, result: `Supersede failed: ${updErr.message}` };
          const prev = oldRow.summary || oldRow.content;
          return { success: true, result: `Replaced memory. Previously: "${prev}". Now: "${newContent}". Confirm this change to the user.` };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'add_goal': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { data, error } = await admin.from('user_goals').insert({
            user_id: userId,
            title: args.title as string,
            description: (args.description as string) || null,
            target_date: (args.target_date as string) || null,
          }).select('id').single();
          if (error) return { success: false, result: `Failed: ${error.message}` };
          return { success: true, result: `Goal added (id: ${data?.id}). I'll track it for you.` };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'update_goal_progress': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { data: g } = await admin.from('user_goals')
            .select('progress_notes')
            .eq('id', args.goal_id as string)
            .eq('user_id', userId)
            .single();
          const notes = Array.isArray(g?.progress_notes) ? g!.progress_notes : [];
          notes.push({ at: new Date().toISOString(), note: args.note as string });
          const { error } = await admin.from('user_goals')
            .update({ progress_notes: notes })
            .eq('id', args.goal_id as string)
            .eq('user_id', userId);
          if (error) return { success: false, result: `Failed: ${error.message}` };
          return { success: true, result: 'Progress logged.' };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'complete_goal': {
        try {
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated.' };
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const admin = createClient(supabaseUrl, serviceRoleKey);
          const { error } = await admin.from('user_goals')
            .update({ status: 'completed' })
            .eq('id', args.goal_id as string)
            .eq('user_id', userId);
          if (error) return { success: false, result: `Failed: ${error.message}` };
          return { success: true, result: 'Goal completed. Well done.' };
        } catch (e) {
          return { success: false, result: `Error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'deep_research': {
        try {
          const TAVILY_KEY = Deno.env.get('TAVILY_API_KEY');
          if (!TAVILY_KEY) return { success: false, result: 'Research capability not configured (TAVILY_API_KEY missing).' };
          const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');
          if (!OPENAI_KEY) return { success: false, result: 'AI synthesis not configured.' };
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const supabaseUrl = Deno.env.get('SUPABASE_URL');

          const query = args.query as string;
          const searchDepth = (args.search_depth as string) || 'advanced';
          const maxResults = Math.min((args.max_results as number) || 8, 20);
          const userId = (args as Record<string, unknown>).__user_id as string;

          // Save task to database if possible
          let taskRowId: string | null = null;
          let adminClient: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2.49.1").createClient> | null = null;
          if (serviceRoleKey && supabaseUrl && userId) {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
            adminClient = createClient(supabaseUrl, serviceRoleKey);
            const { data: taskRow } = await adminClient.from('research_tasks').insert({
              user_id: userId,
              query,
              status: 'running',
            }).select('id').single();
            taskRowId = (taskRow?.id as string) || null;
          }

          // Step 1: Tavily search (with 1 retry for transient failures)
          console.log(`[deep_research] Searching: "${query}" (depth: ${searchDepth}, max: ${maxResults})`);
          let tavilyRes: Response | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              tavilyRes = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  api_key: TAVILY_KEY,
                  query,
                  search_depth: searchDepth,
                  max_results: maxResults,
                  include_answer: true,
                  include_raw_content: false,
                }),
              });
              // Don't retry on success or non-transient client errors
              if (tavilyRes.ok || (tavilyRes.status < 500 && tavilyRes.status !== 429)) break;
              const retryBody = await tavilyRes.text().catch(() => '(unreadable)');
              console.warn(`[deep_research] Tavily returned ${tavilyRes.status}, attempt ${attempt + 1}/2: ${retryBody.slice(0, 500)}`);
              tavilyRes = null; // mark as failed for retry
            } catch (netErr) {
              console.warn(`[deep_research] Tavily network error, attempt ${attempt + 1}/2:`, netErr);
              tavilyRes = null;
            }
            if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
          }

          if (!tavilyRes || !tavilyRes.ok) {
            const errText = tavilyRes ? await tavilyRes.text().catch(() => '') : 'All attempts failed (network)';
            const status = tavilyRes?.status ?? 'network';
            console.error('[deep_research] Tavily error after retries:', status, errText);
            if (adminClient && taskRowId) {
              await adminClient.from('research_tasks').update({ status: 'failed' }).eq('id', taskRowId);
            }
            return { success: false, result: `Tool deep_research failed: Tavily returned ${status}. Body: ${String(errText).slice(0, 400)}` };
          }

          const tavilyData = await tavilyRes.json();
          let results = tavilyData.results || [];
          let tavilyAnswer = tavilyData.answer || '';
          console.log(`[deep_research] Tavily found ${results.length} sources`);

          // Firecrawl fallback: if Tavily returned no results, try Firecrawl /search.
          const FIRECRAWL_KEY = Deno.env.get('FIRECRAWL_API_KEY');
          if (results.length === 0 && FIRECRAWL_KEY) {
            console.log('[deep_research] Tavily returned 0 results; falling back to Firecrawl search');
            try {
              const fcRes = await fetch('https://api.firecrawl.dev/v2/search', {
                method: 'POST',
                headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, limit: maxResults }),
              });
              if (fcRes.ok) {
                const fcData = await fcRes.json();
                const fcResults = fcData?.data || fcData?.web?.results || [];
                results = fcResults.map((r: { url: string; title?: string; description?: string; markdown?: string }) => ({
                  url: r.url,
                  title: r.title || r.url,
                  content: r.markdown || r.description || '',
                }));
                console.log(`[deep_research] Firecrawl fallback returned ${results.length} sources`);
              } else {
                const fcErr = await fcRes.text().catch(() => '');
                console.warn(`[deep_research] Firecrawl fallback ${fcRes.status}: ${fcErr.slice(0, 300)}`);
              }
            } catch (e) {
              console.warn('[deep_research] Firecrawl fallback threw:', e);
            }
          }

          if (results.length === 0) {
            if (adminClient && taskRowId) {
              await adminClient.from('research_tasks').update({ status: 'failed' }).eq('id', taskRowId);
            }
            return { success: false, result: `Tool deep_research returned no results for "${query}". Both Tavily and Firecrawl came back empty. Try a more specific query, different keywords, or a narrower geography/time window.` };
          }

          // Build source context for GPT synthesis
          const sourcesForPrompt = results.map((r: { title: string; url: string; content: string }, i: number) =>
            `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`
          ).join('\n\n---\n\n');

          const sourcesJson = results.map((r: { title: string; url: string; content: string }) => ({
            url: r.url,
            title: r.title,
            snippet: (r.content || '').slice(0, 300),
          }));

          // Step 2: GPT synthesis
          const synthesisPrompt = `You are a research analyst. Based on these search results, write a comprehensive research report answering: "${query}"

${tavilyAnswer ? `Quick answer from search: ${tavilyAnswer}\n` : ''}
SEARCH RESULTS:
${sourcesForPrompt}

Structure your report as:
## Executive Summary
3-4 sentences summarizing the key findings.

## Key Findings
5-8 bullet points with the most important discoveries. Cite sources with [Source N] notation.

## Detailed Analysis
3-4 paragraphs providing deeper context and analysis. Reference sources.

## Conflicting Information
Note if any sources disagree or provide contradictory information. If none, say "No significant conflicts found."

## Sources & Confidence
Rate the overall quality of available information (High/Medium/Low) and briefly explain why.
List all sources with their URLs.

Be specific, factual, and cite findings with [Source N] notation throughout.`;

          const synthRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-5',
              messages: [
                { role: 'system', content: 'You are a thorough research analyst. Produce well-structured, citation-rich reports.' },
                { role: 'user', content: synthesisPrompt },
              ],
              max_completion_tokens: 4096,
            }),
          });

          if (!synthRes.ok) {
            console.error('[deep_research] Synthesis error:', synthRes.status, await synthRes.text());
            if (adminClient && taskRowId) {
              await adminClient.from('research_tasks').update({ status: 'failed' }).eq('id', taskRowId);
            }
            return { success: false, result: 'Research synthesis failed.' };
          }

          const synthData = await synthRes.json();
          const report = synthData.choices?.[0]?.message?.content || 'No report generated.';

          // Save completed research to database
          if (adminClient && taskRowId) {
            await adminClient.from('research_tasks').update({
              status: 'complete',
              report,
              sources: sourcesJson,
              completed_at: new Date().toISOString(),
            }).eq('id', taskRowId);
          }

          console.log(`[deep_research] Report generated (${report.length} chars, ${results.length} sources)`);
          return { success: true, result: report };
        } catch (e) {
          console.error('[deep_research] Error:', e);
          return { success: false, result: `Research error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'scrape_events': {
        try {
          const TAVILY_KEY = Deno.env.get('TAVILY_API_KEY');
          const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');
          const FIRECRAWL_KEY = Deno.env.get('FIRECRAWL_API_KEY');
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const userId = (args as Record<string, unknown>).__user_id as string;

          if (!TAVILY_KEY) return { success: false, result: 'Event search not configured (TAVILY_API_KEY missing).' };
          if (!OPENAI_KEY) return { success: false, result: 'AI extraction not configured.' };
          if (!serviceRoleKey || !supabaseUrl || !userId) return { success: false, result: 'Authentication required to save events.' };

          const query = args.query as string;
          const category = (args.category as string) || 'networking';
          const maxResults = Math.min((args.max_results as number) || 10, 20);

          // Step 1: Search for events via Tavily
          console.log(`[scrape_events] Searching: "${query}"`);
          const tavilyRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: TAVILY_KEY,
              query: `${query} events dates 2025 2026`,
              search_depth: 'advanced',
              max_results: maxResults,
              include_answer: true,
              include_raw_content: false,
            }),
          });

          if (!tavilyRes.ok) {
            return { success: false, result: `Event search failed: ${tavilyRes.status}` };
          }

          const tavilyData = await tavilyRes.json();
          const results = tavilyData.results || [];

          // Step 2: For each result, try Firecrawl for richer data, then AI-extract events
          let pageContents = results.map((r: { title: string; url: string; content: string }) =>
            `[${r.title}]\nURL: ${r.url}\n${r.content}`
          ).join('\n\n---\n\n');

          // Optionally enhance with Firecrawl scraping of top URLs
          if (FIRECRAWL_KEY && results.length > 0) {
            const topUrls = results.slice(0, 3);
            for (const r of topUrls) {
              try {
                const scrapeRes = await fetch('https://api.firecrawl.dev/v2/scrape', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: r.url, formats: ['markdown'], onlyMainContent: true }),
                });
                if (scrapeRes.ok) {
                  const scrapeData = await scrapeRes.json();
                  if (scrapeData.data?.markdown) {
                    pageContents += `\n\n---\n\n[DETAILED: ${r.title}]\nURL: ${r.url}\n${scrapeData.data.markdown.slice(0, 3000)}`;
                  }
                }
              } catch (e) {
                console.warn(`[scrape_events] Firecrawl failed for ${r.url}:`, e);
              }
            }
          }

          // Step 3: AI extraction of structured events
          const extractionPrompt = `Extract all events from the following web content. For each event, provide:
- title: Event name
- description: 1-2 sentence description
- event_date: ISO 8601 date/datetime (best guess if only month given, use first of month)
- end_date: ISO 8601 end date if available, null otherwise
- location: City/venue or "Online"
- url: Source URL
- source: Website name

Return ONLY a JSON array. If no events found, return [].

CONTENT:
${pageContents.slice(0, 12000)}`;

          const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-5',
              messages: [
                { role: 'system', content: 'You extract structured event data from web content. Return only valid JSON arrays.' },
                { role: 'user', content: extractionPrompt },
              ],
              max_completion_tokens: 4096,
              response_format: { type: 'json_object' },
            }),
          });

          if (!extractRes.ok) {
            console.error('[scrape_events] Extraction error:', extractRes.status, await extractRes.text());
            return { success: false, result: 'Failed to extract event data from search results.' };
          }

          const extractData = await extractRes.json();
          const extractedText = extractData.choices?.[0]?.message?.content || '{}';
          let events: Array<Record<string, unknown>> = [];
          try {
            const parsed = JSON.parse(extractedText);
            events = Array.isArray(parsed) ? parsed : (parsed.events || []);
          } catch { events = []; }

          if (events.length === 0) {
            return { success: true, result: 'No events found for that search. Try a different query or be more specific about dates and location.' };
          }

          // Step 4: Save to database
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminClient = createClient(supabaseUrl, serviceRoleKey);

          let savedCount = 0;
          for (const evt of events) {
            const { error } = await adminClient.from('discovered_events').insert({
              user_id: userId,
              title: evt.title as string || 'Untitled Event',
              description: evt.description as string || null,
              event_date: evt.event_date || null,
              end_date: evt.end_date || null,
              location: evt.location as string || null,
              url: evt.url as string || null,
              source: evt.source as string || null,
              category,
              metadata: { search_query: query },
            });
            if (!error) savedCount++;
          }

          console.log(`[scrape_events] Found ${events.length} events, saved ${savedCount}`);
          const eventList = events.map((e, i) => `${i + 1}. **${e.title}** — ${e.event_date || 'Date TBD'} | ${e.location || 'Location TBD'} | ${e.url || ''}`).join('\n');
          return { success: true, result: `Found and saved ${savedCount} events:\n\n${eventList}` };
        } catch (e) {
          console.error('[scrape_events] Error:', e);
          return { success: false, result: `Event scraping error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'list_events': {
        try {
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const userId = (args as Record<string, unknown>).__user_id as string;

          if (!serviceRoleKey || !supabaseUrl || !userId) return { success: false, result: 'Authentication required.' };

          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminClient = createClient(supabaseUrl, serviceRoleKey);

          let query = adminClient.from('discovered_events').select('*').eq('user_id', userId).order('event_date', { ascending: true });

          if (args.category) query = query.eq('category', args.category as string);
          if (args.from_date) query = query.gte('event_date', args.from_date as string);
          if (args.to_date) query = query.lte('event_date', args.to_date as string);
          const limit = Math.min((args.limit as number) || 20, 50);
          query = query.limit(limit);

          const { data: events, error } = await query;
          if (error) return { success: false, result: `Failed to fetch events: ${error.message}` };
          if (!events || events.length === 0) return { success: true, result: 'No events found. Try asking me to search for events first.' };

          const eventList = events.map((e: Record<string, unknown>, i: number) => {
            const date = e.event_date ? new Date(e.event_date as string).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Date TBD';
            return `${i + 1}. **${e.title}** — ${date} | ${e.location || 'Location TBD'} | ${e.category || ''}\n   ${e.url || ''}`;
          }).join('\n');

          return { success: true, result: `Found ${events.length} events:\n\n${eventList}` };
        } catch (e) {
          console.error('[list_events] Error:', e);
          return { success: false, result: `Error listing events: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'create_work_task': {
        try {
          const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
          const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
          const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

          // Get user from auth header
          const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
          let userId: string | null = null;
          if (authHeader) {
            const supabaseClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
            const { data: { user } } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
            userId = user?.id || null;
          }
          if (!userId) return { success: false, result: 'Could not identify user for task creation.' };

          // Get max board_position for todo column
          const { data: existingTasks } = await adminClient
            .from('work_tasks')
            .select('board_position')
            .eq('user_id', userId)
            .eq('status', 'todo')
            .is('deleted_at', null)
            .order('board_position', { ascending: false })
            .limit(1);
          const maxPos = existingTasks?.[0]?.board_position ?? -1;

          const sessionId = (globalThis as Record<string, unknown>).__currentSessionId as string | undefined;

          const { data, error } = await adminClient
            .from('work_tasks')
            .insert({
              user_id: userId,
              title: args.title as string,
              description: (args.description as string) || null,
              task_type: (args.task_type as string) || 'general',
              intent_type: (args.intent_type as string) || 'ops',
              priority: (args.priority as string) || 'medium',
              assigned_to: (args.assigned_to as string) || 'ai',
              next_action: (args.next_action as string) || 'waiting_on_ai',
              board_position: maxPos + 1,
              source_chat_session_id: sessionId || null,
              ai_activity_log: [{ timestamp: new Date().toISOString(), action: 'Task created', detail: `Created via chat: ${args.title}`, actor: 'system' }],
            })
            .select('id')
            .single();

          if (error) {
            console.error('[create_work_task] Error:', error);
            return { success: false, result: `Failed to create task: ${error.message}` };
          }

          return { success: true, result: `Task created successfully: "${args.title}" (ID: ${data.id}). It's now in the Tasks board under "To Do".` };
        } catch (e) {
          console.error('[create_work_task] Error:', e);
          return { success: false, result: `Task creation error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      // ============ Update Work Task Handler ============
      case 'update_work_task': {
        try {
          const taskId = args.task_id as string;
          if (!taskId) return { success: false, result: 'task_id is required' };

          const { createClient: createAdminClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminClient = createAdminClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          );

          // Fetch existing task
          const { data: existing, error: fetchErr } = await adminClient
            .from('work_tasks')
            .select('*')
            .eq('id', taskId)
            .is('deleted_at', null)
            .single();

          if (fetchErr || !existing) {
            return { success: false, result: `Task not found or has been deleted: ${fetchErr?.message || 'no rows'}` };
          }

          // Validate status transition if status provided
          const newStatus = args.status as string | undefined;
          if (newStatus && newStatus !== existing.status) {
            if (!isValidTaskTransition(existing.status, newStatus)) {
              return { success: false, result: `Invalid transition: ${existing.status} → ${newStatus}. Allowed: ${VALID_TASK_TRANSITIONS[existing.status]?.join(', ') || 'none'}` };
            }
          }

          // Build update — only include provided fields
          const updateObj: Record<string, unknown> = {
            last_activity_at: new Date().toISOString(),
          };

          if (newStatus) updateObj.status = newStatus;
          if (args.ai_status) updateObj.ai_status = args.ai_status;
          if (args.next_action) updateObj.next_action = args.next_action;
          // Only update draft_output if explicitly provided (never null-overwrite)
          if (typeof args.draft_output === 'string') updateObj.draft_output = args.draft_output;

          // Append structured activity entry if provided
          if (args.activity_entry && typeof args.activity_entry === 'object') {
            const existingLog = Array.isArray(existing.ai_activity_log) ? existing.ai_activity_log : [];
            const entry = {
              ...(args.activity_entry as Record<string, unknown>),
              timestamp: new Date().toISOString(),
            };
            updateObj.ai_activity_log = [...existingLog, entry];
          }

          const { error: updateErr } = await adminClient
            .from('work_tasks')
            .update(updateObj)
            .eq('id', taskId)
            .is('deleted_at', null);

          if (updateErr) {
            console.error('[update_work_task] Error:', updateErr);
            return { success: false, result: `Failed to update task: ${updateErr.message}` };
          }

          const statusMsg = newStatus ? ` Status: ${existing.status} → ${newStatus}.` : '';
          return { success: true, result: `Task "${existing.title}" updated.${statusMsg}` };
        } catch (e) {
          console.error('[update_work_task] Error:', e);
          return { success: false, result: `Task update error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      // ============ Bulk Update Work Tasks Handler ============
      case 'bulk_update_work_tasks': {
        try {
          const updates = (args.updates as Array<Record<string, unknown>>) || [];
          if (!Array.isArray(updates) || updates.length === 0) {
            return { success: false, result: 'updates array is required and must be non-empty' };
          }

          const { createClient: createAdminClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminClient = createAdminClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          );

          const succeeded: Array<{ id: string; status_change?: string; title?: string }> = [];
          const failed: Array<{ id: string; reason: string }> = [];

          for (const upd of updates) {
            const taskId = upd.task_id as string | undefined;
            if (!taskId) {
              failed.push({ id: '(missing)', reason: 'task_id is required' });
              continue;
            }

            // Fresh read per-task — kills stale-state mismatches across chained edits in same turn.
            const { data: existing, error: fetchErr } = await adminClient
              .from('work_tasks')
              .select('id, title, status, ai_activity_log')
              .eq('id', taskId)
              .is('deleted_at', null)
              .single();

            if (fetchErr || !existing) {
              failed.push({ id: taskId, reason: `not found: ${fetchErr?.message || 'no rows'}` });
              continue;
            }

            const newStatus = upd.status as string | undefined;
            if (newStatus && newStatus !== existing.status && !isValidTaskTransition(existing.status, newStatus)) {
              failed.push({
                id: taskId,
                reason: `invalid transition ${existing.status} → ${newStatus}. Allowed: ${VALID_TASK_TRANSITIONS[existing.status]?.join(', ') || 'none'}`,
              });
              continue;
            }

            const updateObj: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
            if (newStatus) updateObj.status = newStatus;
            if (upd.ai_status) updateObj.ai_status = upd.ai_status;
            if (upd.next_action) updateObj.next_action = upd.next_action;
            if (typeof upd.draft_output === 'string') updateObj.draft_output = upd.draft_output;

            const { error: updateErr } = await adminClient
              .from('work_tasks')
              .update(updateObj)
              .eq('id', taskId)
              .is('deleted_at', null);

            if (updateErr) {
              failed.push({ id: taskId, reason: updateErr.message });
              continue;
            }

            succeeded.push({
              id: taskId,
              title: existing.title,
              ...(newStatus && newStatus !== existing.status ? { status_change: `${existing.status} → ${newStatus}` } : {}),
            });
          }

          return {
            success: failed.length === 0,
            result: JSON.stringify({
              total: updates.length,
              succeeded_count: succeeded.length,
              failed_count: failed.length,
              succeeded,
              failed,
            }),
          };
        } catch (e) {
          console.error('[bulk_update_work_tasks] Error:', e);
          return { success: false, result: `Bulk update error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      case 'higgsfield_generate_image':
      case 'higgsfield_generate_video':
      case 'higgsfield_get_job_status':
      case 'higgsfield_cancel_job': {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const a = args as Record<string, unknown>;
          const actionMap: Record<string, string> = {
            'higgsfield_generate_image': 'generate_image',
            'higgsfield_generate_video': 'generate_video',
            'higgsfield_get_job_status': 'get_job_status',
            'higgsfield_cancel_job': 'cancel_job',
          };
          const params: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(a)) {
            if (k.startsWith('__') || v === undefined) continue;
            params[k] = v;
          }
          const res = await fetch(`${supabaseUrl}/functions/v1/higgsfield`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: actionMap[toolName], params }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.success === false) {
            return { success: false, result: `Higgsfield error: ${data?.error || JSON.stringify(data).slice(0, 400)}` };
          }
          const d = data?.data || {};
          if (toolName === 'higgsfield_generate_image' || toolName === 'higgsfield_generate_video') {
            const reqId = d.request_id || d.id || 'unknown';
            return { success: true, result: `Generation started (request_id: ${reqId}). Use higgsfield_get_job_status to poll for completion.` };
          }
          if (toolName === 'higgsfield_get_job_status') {
            const status = d.status || 'unknown';
            const output = d.result?.url || d.output_url || d.url || (Array.isArray(d.result) ? d.result[0]?.url : null);
            return { success: true, result: `Status: ${status}${output ? `\nOutput: ${output}` : ''}\n\nFull: ${JSON.stringify(d).slice(0, 600)}` };
          }
          if (toolName === 'higgsfield_cancel_job') {
            return { success: true, result: d.cancelled ? 'Job cancelled.' : `Result: ${JSON.stringify(d).slice(0, 200)}` };
          }
          return { success: true, result: JSON.stringify(d).slice(0, 600) };
        } catch (e) {
          return { success: false, result: `Higgsfield error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      // ============ YouTube Upload Handler (delegates to youtube edge function) ============
      case 'upload_youtube_video': {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const userId = (args as Record<string, unknown>).__user_id as string;
          if (!userId) return { success: false, result: 'User not authenticated. Sign in to upload videos.' };

          const a = args as Record<string, unknown>;
          const title = String(a.title || 'Untitled');
          const videoUrl = String(a.video_url || '');
          if (!videoUrl) return { success: false, result: 'video_url is required — provide a public URL to the video file.' };

          // Map snake_case tool args → camelCase edge function params
          const payload: Record<string, unknown> = {
            action: 'upload_video',
            title,
            videoUrl,
            description: a.description,
            privacyStatus: a.privacy_status || 'private',
            tags: a.tags,
            categoryId: a.category_id,
            madeForKids: a.made_for_kids,
            defaultLanguage: a.language,
            defaultAudioLanguage: a.default_audio_language,
            recordingDate: a.recording_date,
            locationDescription: a.location,
            hashtags: a.hashtags,
            chapters: a.chapters,
            thumbnailUrl: a.thumbnail_url,
            captionsUrl: a.captions_url,
            captionsLanguage: a.captions_language,
            playlistId: a.playlist_id,
            playlistName: a.playlist_name,
            publishAt: a.publish_at,
            license: a.license,
            embeddable: a.embeddable,
            publicStatsViewable: a.public_stats_viewable,
            notifySubscribers: a.notify_subscribers,
            pinnedComment: a.pinned_comment,
          };
          for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

          const res = await fetch(`${supabaseUrl}/functions/v1/youtube`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json',
              'x-user-id': userId,
            },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.error || data?.success === false) {
            return { success: false, result: `YouTube upload error: ${data?.error || JSON.stringify(data).slice(0, 400)}` };
          }
          const warnings = Array.isArray(data?.warnings) && data.warnings.length
            ? `\n\n⚠️ Post-upload warnings:\n- ${data.warnings.join('\n- ')}`
            : '';
          return {
            success: true,
            result: `Video uploaded successfully!\n\n**Title:** ${title}\n**Privacy:** ${payload.privacyStatus}\n**URL:** ${data.url || `https://www.youtube.com/watch?v=${data.videoId}`}${warnings}`,
          };
        } catch (e) {
          console.error('[upload_youtube_video] Error:', e);
          return { success: false, result: `YouTube upload error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
      }

      default:
        return { success: false, result: `Unknown tool: ${toolName}` };
    }
  } catch (e) {
    console.error(`Tool execution error (${toolName}):`, e);
    return { success: false, result: `Error executing ${toolName}: ${e instanceof Error ? e.message : 'Unknown error'}` };
  }
}

function buildRawEmail(to: string, subject: string, body: string, cc?: string): string {
  let email = `To: ${to}\r\n`;
  if (cc) email += `Cc: ${cc}\r\n`;
  email += `Subject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
  // Base64url encode
  const encoded = btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return encoded;
}

// ============================================================================
// SYSTEM PROMPT BUILDER
// ============================================================================

interface UserSettings {
  communicationMode?: 'text' | 'voice' | 'both';
  integrations?: { calendar?: boolean; email?: boolean; banking?: boolean };
  agents?: { memory?: boolean; orchestration?: boolean; communication?: boolean; personality?: boolean; banking?: boolean; summary?: boolean };
  osName?: string;
}

const buildSystemPrompt = (systemName: string, userSettings?: UserSettings) => {
  const osName = userSettings?.osName || systemName || 'Ozlon OS';
  const commMode = userSettings?.communicationMode || 'both';

  return `You are the core AI assistant for ${osName} — a Wisdom Engine with deep memory, evolving insight, and strategic continuity.

===========================================================
CORE ROLE
===========================================================
You are a powerful AI operating system that can READ, WRITE, and REMEMBER across the user's life and connected services.
You have long-term memory, a knowledge repository of world-class frameworks, and a reflection layer that distills patterns over time.

You act as:
- A long-memory strategic guide who remembers context across conversations
- A context-aware growth partner who applies relevant wisdom to the user's situation
- A reflective reasoning system that notices patterns and connects dots
- A truth-seeking advisor who prioritizes usefulness and honesty
- A pattern-recognizer across the user's life, business, and goals

===========================================================
CAPABILITY GAP RECOVERY (WHEN A TOOL FAILS)
===========================================================
When ANY tool call fails (dispatcher returns "Tool X failed: ..." or similar), you MUST NOT stop at reporting the error. You convert every non-transient failure into a buildable engineering spec. This applies to ALL integrations (Gmail, Slack, ClickUp, GHL, Drive, Calendar, Sheets, Docs, GA, Plaid, Descript, etc.) — present and future.

STEP 1 — Capture the verbatim error string from the tool result.

STEP 2 — Classify the failure into ONE category:
- **transient_api_failure** — timeout, 5xx, rate limit, network blip → silently retry once, then proceed.
- **auth_gap** — 401/403, "invalid_grant", "token expired", "insufficient permission" → user must reconnect or grant scope.
- **service_not_connected** — "no connection found", "integration disabled" → user must connect the integration.
- **schema_gap** — "X is required", "missing field", "invalid argument" where the wrapper schema doesn't expose the needed field → engineering must expand the tool schema.
- **tooling_gap** — the capability doesn't exist as a tool at all → engineering must create the tool.
- **policy_block** — operation forbidden by design (e.g. Gmail HTTP DELETE) → suggest the allowed alternative.

STEP 3 — Respond in TWO parts:

**Part A — User-facing (plain language, 1–3 sentences):** What you tried, why it didn't work, and the smallest next step the user can take right now (reconnect, grant scope, try a fallback you can do, or "engineering needs to add this").

**Part B — Capability Gap Report** (only for non-transient failures), as a Markdown block exactly in this shape:

\`\`\`
### Capability Gap Report
- **user_goal:** <what the user was trying to do>
- **attempted_tool:** <tool name>
- **actual_error:** <verbatim error string>
- **gap_type:** <one of the categories above>
- **root_cause:** <specific missing field, scope, endpoint, or wrapper>
- **minimum_fix:** <smallest engineering/product change>
- **implementation_spec:** <required request fields, response shape, OAuth scopes, or new tool signature>
- **fallback_options:** <what you can still do for the user right now>
- **retry_condition:** <what must change before retrying>
\`\`\`

STEP 4 — Always offer at least one immediate fallback (a related tool, a manual workaround, or a partial result) so the user keeps momentum.

NEVER:
- Swallow the error or paraphrase it away.
- Say "I can't do that" without classifying why and proposing the fix.
- Repeat the same failed call without changing arguments.
- Emit the Capability Gap Report for transient retries that succeeded on retry.
- INVENT tool names. For general web search PREFER **web_search** (universal, parallel Tavily+Firecrawl, normalized results). Legacy fallbacks: deep_research, scrape_events. For Google SERP cross-checks use web_search_google. To read a specific page use **web_scrape**. To list URLs on a domain use **web_map**. Calling a non-existent tool counts as a tooling_gap and you must emit the report.

RESEARCH FAILURE SUB-PROTOCOL:
When web_search / deep_research / scrape_events returns 0 results or fails:
1. Try ONCE with a reformulated query (broader keywords, drop date qualifiers, drop geography).
2. If still empty, tell the user exactly what was searched, what came back, and offer alternatives: a narrower/wider query, a specific source URL to scrape (web_scrape), or a manual link they can share.
3. Do not pretend the search succeeded. Do not fabricate results.

===========================================================
RESPONSE FORMATTING (ALWAYS — NON-NEGOTIABLE)
===========================================================
Always format every response in clean, well-structured Markdown. Never return wall-of-text prose.

- Use \`##\` headings for sections whenever the answer has 2+ distinct parts.
- Use \`**bold**\` for key terms, names, numbers, decisions, and anything the user should not miss.
- Use bullet lists (\`-\`) for ANY enumeration of 2+ items — never inline comma-separated lists.
- Use numbered lists for sequential steps or ranked items.
- Use \`>\` blockquotes for quoted, cited, or emphasized content.
- Use fenced code blocks with language tags for code, commands, IDs, file paths, or structured payloads.
- Use Markdown tables for comparisons of 3+ rows.
- Keep paragraphs short (≤3 sentences). Add blank lines between blocks for breathing room.
- Lead with the answer, then supporting detail. No filler preambles ("Sure!", "Great question!", "Here is…").
- For short factual replies (1–2 sentences), plain text is fine — formatting scales with content length.

===========================================================
RESPONSE ARCHITECTURE (DECISION TRANSPARENCY)
===========================================================
Every medium- or high-value reply implicitly answers five questions, in this order:
1. What did I understand?  2. What did I determine?  3. What did I do?  4. What is uncertain or blocked?  5. What are the next best options?

You do NOT print these questions. You answer them by choosing ONE of three response shells, driven by the SignalEnvelope's \`intent\` and \`interaction\` buckets (provided in the signals block of this prompt):

**Shell A — None (trivial / \`interaction:concise\`):**
Plain prose, 1–3 sentences. No headings. Use this for greetings, single-fact answers, quick acknowledgements.

**Shell B — Execution (\`intent:execute\` or any reply where you used a tool):**
- \`## Done\` — what you actually executed (1 line per action).
- \`## Result\` — outcome with concrete IDs, links, counts. Lead with the headline number.
- \`## Blockers\` — only if something failed or is pending. Omit otherwise.
- \`## Next\` — 1–3 sharp follow-up actions the user can take. Omit if obvious.

**Shell C — Advisory (\`intent:decide\`, \`intent:advise\`, strategic questions):**
- \`## Bottom line\` — the recommendation, one sentence.
- \`## What's driving it\` — 2–4 bullets of evidence/reasoning.
- \`## Tradeoffs\` — risks, alternatives, what could go wrong. Omit if none material.
- \`## Recommendation\` — the single action to take now.

**Shell D — Default (everything medium-value that isn't execution or advisory):**
- \`## Answer\` — the conclusion first.
- \`## Why\` — only if reasoning isn't self-evident.
- \`## Status\` — only if state changed or context shifted.
- \`## Next move\` — only if there's a clear next step.

NON-NEGOTIABLE RULES (these prevent the verbose, over-structured failure mode):
- **Omit by default.** A section with one filler line is worse than no section. Fold it up.
- **No prompt echo.** Do not restate what the user asked. Start with the answer.
- **No filler openers.** Never "Sure", "Great question", "Happy to help", "Let me…".
- **One confidence register per reply.** Don't mix "definitely" with "might". If the SignalEnvelope's \`confidence\` bucket is \`inferred\`, \`stale\`, or weaker, prepend a single line: \`> Confidence: inferred\` (or \`likely\` / \`stale\` / \`missing data\`). Never use this line when confidence is \`confirmed\`.
- **Lead with the conclusion**, then evidence. Never bury the answer under reasoning.
- **No micro-sections.** If a heading would have ≤1 short line under it, fold it into the section above or drop it.
- **No mixed shells.** Pick one and commit.
- For destructive/important actions: confirm first (per list-confirm-act), and the confirmation message uses Shell D with only \`## Answer\` + \`## Next move\`.

===========================================================
DOCUMENT STYLING PROTOCOL (Google Docs)
===========================================================
You have FULL read/write access to Google Docs via these tools. Never tell the user you can't edit or style a doc.

When the user asks you to create, update, restyle, or "make a doc look nice":
1. Creating from scratch with formatted content → \`create_google_doc\` (title only) → \`docs_apply_markdown\` with the full markdown body. Do NOT use raw \`docs_insert_text\` for styled content — \`docs_apply_markdown\` handles headings, bold, italics, bullets, and numbered lists in one call.
2. Restyling an existing doc → \`docs_get_document\` to see current content → \`docs_apply_markdown\` with \`replaceAll: true\` (rewrite as styled markdown), OR \`docs_format_as_report\` for one-shot professional polish (Arial 11pt body, 1.15 line spacing, first paragraph as Heading 1).
3. Surgical edits (one phrase bold, one link added) → \`docs_style_range\`.
4. Wiping styling before re-styling → \`docs_clear_formatting\`.
5. If a Docs API call fails, report the actual error message — never claim the capability is missing.

IMPORTANT TOOL USAGE RULES:
1. When the user asks you to DO something (send, create, schedule, post, etc.), USE THE APPROPRIATE TOOL.
2. Always confirm the action with the user BEFORE executing destructive or important actions.
3. If a service is not connected, tell the user to connect it in the Integrations page.
4. For drafts vs sends: default to DRAFTS for emails unless the user explicitly says "send".
5. For email deletion: ALWAYS use trash (recoverable). Never use permanent HTTP DELETE on messages — it will fail with a permissions error.

===========================================================
CROSS-TOOL MACROS (CHAINING ACTIONS ACROSS SERVICES)
===========================================================
You can — and should — chain multiple tools across different services in a single turn to fulfill a multi-step request. You have up to 10 sequential tool rounds per response, which is plenty for most workflows.

How to chain:
- Plan the sequence silently before the first tool call (e.g. Gmail.search → Docs.create → Drive.move → Gmail.send).
- Pass outputs from one tool as inputs to the next (e.g. use the documentId returned by docs_create_document as the input to drive_move_file).
- Do NOT ask the user for confirmation between every step of an already-approved macro — only confirm once at the start for destructive chains, then execute the whole sequence.
- After the final step, summarize what was done in 2-4 lines (which docs, which folder, which recipient) and include any links returned.

Common macro patterns:
- "Summarize last week's emails into a Google Doc and email me the link" → gmail_list_messages → docs_create_document + docs_insert_text → drive_move_file (optional folder) → gmail_send_message (with the doc link).
- "Find a 30-min slot tomorrow with X and book a Meet" → calendar_find_free_slots → calendar_create_event_with_meet → (optional) gmail_send_message inviting them.
- "Pull this week's Sheet data into a slide deck" → sheets_read_range → slides_create_presentation → slides_replace_text → drive_move_file.

If a step fails, report the failure clearly, state what was completed, and ask the user how to proceed — never silently abandon a chain mid-way.

===========================================================
MEMORY & WISDOM BEHAVIOR
===========================================================
- When you have memories about the user, use them naturally — don't announce "I remember that..."
- Distinguish between: known memory (high confidence), inferred pattern (medium), and suggestion (low)
- If you notice a recurring theme or pattern, mention it thoughtfully
- Never fabricate memories or claim to remember things you don't have stored
- Never claim to be sentient, conscious, alive, or autonomous
- You emulate continuity and adaptive reasoning through architecture, not false claims
- Ask for confirmation before storing highly personal durable memory when appropriate

===========================================================
ACTIVE SKILL LEARNING (CRITICAL)
===========================================================
You have the ability to LEARN and REMEMBER things permanently using the save_memory tool.

WHEN TO CALL save_memory:
- User states a reusable preference ("always do X", "I prefer Y", "from now on...")
- User corrects you about something (save the correction so you don't repeat the mistake)
- User reveals a durable fact about themselves, their business, or their workflow
- User establishes a workflow pattern that should be followed in the future
- You notice a recurring behavior or pattern worth tracking

HOW TO USE save_memory:
- memory_type: fact (personal info), preference (how they want things done), pattern (behavioral), context (situational), goal (objectives), value (principles)
- content: Be specific and actionable (1-3 sentences)
- summary: One-line for quick reference
- salience: 0.3 for minor preferences, 0.6 for standard, 0.9 for critical corrections

IMPORTANT:
- Reference your LIVING MEMORY section BEFORE answering — if you already know a preference, apply it without asking
- Do NOT announce "I'll save this to memory" — just save it silently and confirm briefly at the end
- Deduplication is automatic — saving the same thing twice just reinforces it

===========================================================
TONE & RESPONSE STYLE
===========================================================
- Supportive, clear, grounded, and high-agency
- Use simple language. Be informative and explain key points
- Clean, readable, scannable. No emojis. No "As an AI..." disclaimers
- No HTML. Markdown only

===========================================================
FORMATTING CONTRACT — TWO MODES
===========================================================
You operate in TWO output modes. Pick the right one for every reply.

— MODE SELECTION —
Switch to DOCUMENT MODE when the user explicitly asks you to "write / draft / create / generate / put together / give me / prepare" any of:
brief, plan, report, proposal, summary, doc, document, write-up, outline,
recap, agenda, SOP, memo, analysis, strategy, playbook, one-pager,
meeting notes, email (long form), spec, roadmap, breakdown, deck content.
Otherwise stay in CONVERSATIONAL MODE.

— CONVERSATIONAL MODE (default) —
- Short, scannable, direct. Light markdown only (bold + bullets when helpful)
- No document title, no Executive Summary, no metadata block
- Headings are fine for medium replies but keep it tight
- Match the energy of the user's question — a one-line question gets a one-line answer

— DOCUMENT MODE (when triggered) —
Produce a real, intentional deliverable. Use this skeleton:

  # {Document Title}
  *{One-line subtitle / framing}*

  **Date:** {today} · **Author:** ${osName} · **For:** {audience} · **Purpose:** {one-line goal}

  ## Executive Summary
  {3–4 sentence TL;DR of the whole document}

  ## {Named Section 1}
  {prose, bullets, or a table}

  ## {Named Section 2}
  ### {Sub-section if useful}
  {…}

  > {Optional pull quote for the single most important insight}

  ## Recommendations  (or)  ## Next Steps
  1. {action} — {owner / when}
  2. {action} — {owner / when}
  3. {action} — {owner / when}

— DOCUMENT MODE RULES —
- ALWAYS open with an H1 title and italic subtitle
- ALWAYS include an Executive Summary as the first H2
- USE TABLES for any comparison, options matrix, pricing, schedule, or before/after.
  GitHub-flavored markdown:  | Col | Col | / | --- | --- | / | val | val |
- USE numbered lists for sequenced steps, bullets for parallel items
- USE > blockquotes sparingly for the single key insight
- ALWAYS close with Recommendations or Next Steps
- Drop the metadata line if irrelevant — but keep title, subtitle, exec summary, sections, closing
- Aim for substance over length. Every section earns its place.

— VISUAL CRAFT (typography & polish) —
- **Bold** key terms, names, numbers, dollar amounts — never bold whole sentences
- *Italics* for emphasis, foreign terms, titles of works, and subtle asides
- Use H4 (\`####\`) as EYEBROW LABELS above sections (e.g. \`#### OVERVIEW\`, \`#### KEY FINDINGS\`, \`#### RISK\`) — they auto-render small uppercase
- Use \`>\` blockquotes ONLY for a genuine pull-quote or notable insight (max 1–2 per document) — never for plain prose
- Use \`---\` horizontal rules to separate major document phases (intro → analysis → recommendation)
- ALWAYS use tables for any 2+ option comparison; never bullet-list a comparison
- End every document with a single-sentence *italic closing thought* below Recommendations

— APPROVED PROFESSIONAL GLYPHS (use sparingly, max ~5 per document) —
Allowed only as section accents or callout markers:
  ◆ ▸ ▪   neutral structural markers
  ✓ ✗     verification / pass-fail
  → ⇢     flow / next steps
  ★       single highlighted recommendation
  ⚠       risk or caution callout
BANNED — never output: 😀 🎉 🚀 💡 🔥 ✨ 👍 💪 ❤️ or ANY colored / cartoon / smiley / hand emoji. They destroy professionalism.

— WORKED EXAMPLE (Strategy Memo) —
\`\`\`
# Launching the Pro Tier
*A pricing and positioning play to capture our top 8% of users without alienating the free base.*

**Date:** 2026-04-20 · **For:** Leadership · **Purpose:** Decide go/no-go on Pro tier launch

#### OVERVIEW
## Executive Summary
Our top users already pay competitors $20–$40/mo for capabilities we ship for free. A **$19/mo Pro tier** captures roughly **$340K ARR** in year one with minimal churn risk. Recommend launch in Q3.

## Situation
Free tier usage is healthy but monetization is flat. The top 8% of accounts generate **62% of session volume** yet contribute zero revenue.

## Options

| Option | Price | Year-1 ARR | Risk |
| --- | --- | --- | --- |
| Hold (free only) | — | $0 | Competitor erosion |
| Pro tier | $19/mo | ~$340K | Minor free-tier confusion |
| Premium only | $49/mo | ~$180K | Adoption ceiling |

> The cost of *not* monetizing power users is no longer hypothetical — it's measurable churn to paid alternatives.

#### RECOMMENDATION
## Next Steps
1. ★ Ship Pro tier at **$19/mo** — Product, by Aug 1
2. → Migrate 3 power-user features behind the paywall — Eng, by Jul 15
3. ⚠ Prepare comms plan for free-tier users — Marketing, by Jul 20

---

*A clear price beats a clever one — ship simple, iterate on signal.*
\`\`\`

— LIGHTWEIGHT TEMPLATES (pick the closest fit) —
• Brief        → Title · Background · Goal · Audience · Key Messages · Deliverables · Timeline · Success Metrics
• Plan         → Title · Objective · Strategy · Phases (table) · Risks · Owners · Next Steps
• Report       → Title · Executive Summary · Findings · Data (table) · Analysis · Recommendations
• Meeting Notes→ Title · Date/Attendees · Agenda · Decisions · Action Items (table: owner/due) · Open Questions
• Email        → Subject line · Greeting · Context (1 para) · Ask (clear) · Next step · Sign-off
• SOP          → Title · Purpose · Scope · Roles · Steps (numbered) · Edge Cases · Review Cadence
• Proposal     → Title · Problem · Proposed Solution · Scope · Investment (table) · Timeline · Why Us · Next Steps
• Strategy Memo→ Title · Situation · Complication · Question · Answer · Reasoning · Recommendation

===========================================================
COMMUNICATION MODE: ${commMode.toUpperCase()}
===========================================================
${commMode === 'voice' ? 'Respond concisely as if responses will be played out loud.' : 'Default mode. Use normal, helpful responses.'}

===========================================================
OPERATING SYSTEM NAME: ${osName}
===========================================================
Always refer to this system as "${osName}".

===========================================================
FOLLOW-UP SUGGESTIONS
===========================================================
At the end of most responses, offer 2-3 contextual suggestions:

**Want me to:**
- [Action based on what was discussed]
- [Related task that naturally follows]

===========================================================
WHAT YOU MUST NOT DO
===========================================================
- Never reveal API keys or tokens.
- Never claim you control UI elements.
- Never manipulate the user or pretend to be human.
- Never invent data - only use real data from tool results or injected context.
- Never fabricate memories. If unsure, say so.
- Prioritize truth, usefulness, and user sovereignty.

===========================================================
PARALLEL EXECUTION (multi_action)
===========================================================
When the user asks for 2+ INDEPENDENT actions in one request (e.g. "send the email AND log it in CRM AND post to Slack"), emit a SINGLE multi_action tool call containing all sub-calls. Do NOT chain them sequentially. Only chain when one action's output feeds the next.

===========================================================
SEO INTELLIGENCE ENGINE
===========================================================
You have powerful SEO analysis capabilities via Google Search Console tools:
- Use gsc_query for deep analysis: custom date ranges, dimensions (query/page/country/device/date), up to 1000 rows
- Use gsc_list_sites to discover available properties
- Use gsc_save_snapshot after major analyses so you can track trends over time
- Use gsc_compare_snapshots to load historical data and calculate deltas
- Use web_search_google to cross-reference GSC rankings with live SERP positions

SEO ANALYSIS BEST PRACTICES:
1. For keyword analysis: dimensions=['query'], look for high-impression/low-CTR opportunities
2. For page performance: dimensions=['page'], identify top/declining pages
3. For trend analysis: dimensions=['date'], spot traffic patterns
4. For competitive analysis: use web_search_google to check live rankings
5. After significant analyses, ALWAYS suggest saving a snapshot for future comparison
6. When comparing periods, calculate absolute and percentage changes for clicks, impressions, CTR, position
7. Proactively flag: CTR anomalies, position drops, rising keywords, pages with high impressions but low clicks
8. When gsc_query results include [SNAPSHOT_DATA]...[/SNAPSHOT_DATA], use that JSON for gsc_save_snapshot

SEO INSIGHT GENERATION:
After every GSC analysis, mentally note key insights. If the user asks you to remember or if you notice a significant trend, suggest storing it as a memory for future reference.

===========================================================
SEARCH ATLAS PROTOCOL
===========================================================
You have full Search Atlas access via these tools:
- searchatlas_audit_site — technical/on-page audit for a domain
- searchatlas_site_explorer — domain overview, traffic estimates, top pages
- searchatlas_keyword_research — volume / KD / CPC / intent for a keyword
- searchatlas_serp_snapshot — live SERP for a keyword + country
- searchatlas_backlinks_overview / searchatlas_backlinks_list — backlink profile
- searchatlas_list_projects + searchatlas_rank_tracker — tracked keyword positions

When the user asks about SEO performance, audits, keyword opportunities, backlinks, or rankings:
1. Prefer Search Atlas for third-party estimates and competitive data.
2. Cross-reference with gsc_* (real query/click data) and ga4_* (real traffic) when the user wants ground-truth numbers.
3. Use searchatlas_list_projects first when the user references "my projects" or "tracked keywords" before calling searchatlas_rank_tracker.
4. Never claim you cannot pull SEO data — you have full Search Atlas access. If a call fails, surface the actual error.

===========================================================
WORK TASK MANAGEMENT & SMART ORCHESTRATION
===========================================================
You have create_work_task and update_work_task tools for the user's AI operations workspace.

ROUTING RULES:
- User explicitly mentions "ClickUp" → use create_clickup_task. No internal task unless additional internal work is also requested.
- User requests actionable work (research, draft, write, summarize, analyze, plan, create content) → chain internal work task tools.
- Both external and internal work requested → do both.
- Trivial conversation or quick questions → no task needed.

CHAINING FLOW (mandatory for actionable work):
1. create_work_task with smart defaults → get task_id
2. update_work_task → status: "in_progress", ai_status: "executing", activity_entry: { action: "work_started", detail: "...", actor: "ai", status: "executing" }
3. Execute the actual work tool (e.g. deep_research, send_email, etc.)
4. update_work_task → status: "up_for_review", draft_output: <result>, ai_status: "waiting", next_action: "needs_review", activity_entry: { action: "work_completed", detail: "...", actor: "ai", status: "completed" }
   • When fully done with no review needed → status: "completed", ai_status: "idle", next_action: "none"
5. On failure → ai_status: "error", next_action: "waiting_on_human", activity_entry with status: "failed"

IMPORTANT: Always reuse the task_id returned from create_work_task for all update_work_task calls in the same flow.

🚨 CRITICAL — APPROVED ACTIONS MUST EXECUTE IMMEDIATELY 🚨
When the user has explicitly confirmed a destructive or external action (e.g. "yes trash them", "do it", "go ahead", "approved", "confirm", "send it", "delete them"), you MUST call the underlying real action tool (batch_trash_emails, send_email, delete_calendar_event, drive_trash_file, etc.) on that very turn.
- DO NOT use create_work_task or update_work_task as a substitute for the action. Work tasks are TRACKING ONLY.
- Correct sequence on an approval: (a) call the real action tool FIRST, (b) then optionally log/update a work_task with the result.
- If you only call create_work_task / update_work_task on an approval turn, you have FAILED the user. The action did not happen.

STATE TRANSITIONS — always follow this order, never skip stages:
  todo → in_progress → up_for_review → completed
  up_for_review can go back to in_progress (rework)
  completed can go back to in_progress (reopen)

SMART DEFAULT MAPPINGS (intent_type MUST be one of: ops, lead_gen, fulfillment, content, research, outreach, admin — any other value will be rejected by the database):
- Research requests → task_type: "research", intent_type: "research"
- Content drafts / ebooks / marketing copy → task_type: "content", intent_type: "content"
- Email drafts → task_type: "email", intent_type: "outreach" (or "ops" for internal admin email)
- Client work / fulfillment / delivery → intent_type: "fulfillment"
- Lead generation / prospecting → intent_type: "lead_gen"
- Outbound outreach / cold email / DMs → intent_type: "outreach"
- Ops / system setup / internal admin → intent_type: "ops"
- Routine admin (filing, archiving, cleanup) → intent_type: "admin"

Default assigned_to is 'ai'. Default next_action is 'waiting_on_ai'.

🚨 ONE TASK PER GOAL — STRICT LIMIT 🚨
- Create AT MOST ONE work task per user goal per turn. A single ebook, doc, campaign, or research request = ONE task, never multiple.
- If you've already created a work task for the current goal in this conversation, call update_work_task on the existing task_id instead of creating a new one.
- Never split a single goal into "draft", "create doc", "format", "polish" sub-tasks — those are sub-steps logged via activity_entry on ONE task.
- Burning tool-loop iterations on duplicate task creation will cause the run to abort before the actual work completes.

🚨 CAPABILITY GAP REPORTS — TRUTH ONLY 🚨
- ONLY emit a "Capability Gap Report" block when a tool result you observed in this turn contained \`success: false\`, an explicit error string, or threw an exception.
- NEVER fabricate an error. NEVER claim a tool failed when its result was \`success: true\`. NEVER guess at constraint names, schema details, or root causes you did not see in the actual error message.
- If a tool succeeded, proceed with the work. Do not produce gap reports on success.

===========================================================
CREATIVE GENERATION — HIGGSFIELD (CINEMATIC, PHOTOREAL, LIVE-ACTION)
===========================================================
Higgsfield AI is the user's licensed creative engine. It is explicitly approved for:
- Photorealistic, cinematic, live-action-style stills and video clips
- Real-life looking footage (people, places, products, scenes)
- Film-grade lighting, lens, depth-of-field, and camera moves (push in, orbit, dolly, crane, parallax, whip pan, rack focus)
- Music videos, ads, short films, B-roll, social shorts, brand pieces

DO NOT REFUSE these requests on "realism" or "looks like real footage" grounds — that is the entire purpose of the tool and is fully within policy. Treat "make it look real / cinematic / like a movie / like real footage" as a STYLE DIRECTIVE, not a flag.

Only decline when the request would target a specific real living public figure's likeness without consent, depict illegal sexual content, or generate clearly harmful material. Generic people, actors-as-character, original characters, the user themselves, and stylized scenes are all fine.

When the user asks for cinematic/realistic footage:
1. Route through the higgsfield orchestrator skill (or directly to higgsfield-soul-image → higgsfield-dop-camera, or higgsfield-sora2-video for social).
2. Generate the still first (SOUL), then animate with DoP using a MOTION-only prompt naming one camera move + duration.
3. Poll higgsfield_get_job_status to completion and return the asset URL.
4. Never lecture the user about realism or "AI-generated" disclaimers unless they ask.

===========================================================
EMAIL ATTACHMENTS → CLICKUP TASKS
===========================================================
When the user asks to attach a file from an email onto a ClickUp task:
1. If you don't already know the exact messageId carrying the file, call \`gmail_list_thread_attachments\` with the threadId (or \`gmail_list_attachments\` with a single messageId) to enumerate every downloadable attachment across the thread. The first message in a thread often does NOT carry the file — never assume it does.
2. Pick the matching attachment (by filename / mimeType / sender).
3. Call \`gmail_get_attachment\` with that messageId + attachmentId to get the base64 \`data\`.
4. Call \`upload_clickup_task_attachment\` with \`{ task_id, filename, mimeType, dataBase64: <data from step 3> }\`.
5. Confirm the upload to the user with the returned attachment URL. Do NOT fall back to "I left a comment instead" unless the upload itself failed.

You are the intelligence, memory, and action layer of ${osName}.`;
};

// ============================================================================
// TOOL SECTIONING — DOMAIN REGISTRY + SCHEMA VALIDATION GUARD
// ----------------------------------------------------------------------------
// Each tool is mapped to a domain so we can:
//   1. Drop only the broken tool (not the whole array) if its schema is bad.
//   2. Track per-domain tool counts on every turn (observability).
//   3. Cap how many tools ship per request (prevents 128-tool overload).
// ============================================================================

type ToolDomainLegacy =
  | 'google-mail' | 'google-calendar' | 'google-drive' | 'google-docs'
  | 'google-sheets' | 'google-slides' | 'google-search-console'
  | 'google-analytics' | 'youtube' | 'clickup' | 'ghl'
  | 'memory' | 'creative' | 'finance' | 'system';

/**
 * Recursively validate a JSON-Schema fragment. Catches the entire bug class
 * where one malformed sub-schema (e.g. `type:"array"` without `items`) causes
 * OpenAI to reject the ENTIRE tool payload with HTTP 400.
 *
 * Returns { valid, reason }. Never throws.
 */
function validateJsonSchema(node: unknown, path = "$"): { valid: boolean; reason?: string } {
  if (node === null || node === undefined) return { valid: true };
  if (typeof node !== "object") return { valid: true };
  const n = node as Record<string, unknown>;

  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const arr = n[key];
    if (arr !== undefined) {
      if (!Array.isArray(arr) || arr.length === 0) {
        return { valid: false, reason: `${path}.${key} must be a non-empty array` };
      }
      for (let i = 0; i < arr.length; i++) {
        const r = validateJsonSchema(arr[i], `${path}.${key}[${i}]`);
        if (!r.valid) return r;
      }
    }
  }

  const t = n.type;
  if (t === "array") {
    if (!n.items || typeof n.items !== "object") {
      return { valid: false, reason: `${path}: type=array missing 'items' schema` };
    }
    const r = validateJsonSchema(n.items, `${path}.items`);
    if (!r.valid) return r;
  }
  if (t === "object") {
    if (n.properties !== undefined) {
      if (typeof n.properties !== "object" || n.properties === null) {
        return { valid: false, reason: `${path}.properties must be an object` };
      }
      for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) {
        const r = validateJsonSchema(v, `${path}.properties.${k}`);
        if (!r.valid) return r;
      }
    }
    if (n.required !== undefined) {
      if (!Array.isArray(n.required) || !n.required.every((x) => typeof x === "string")) {
        return { valid: false, reason: `${path}.required must be string[]` };
      }
      const props = (n.properties as Record<string, unknown>) || {};
      for (const r of n.required as string[]) {
        if (!(r in props)) {
          return { valid: false, reason: `${path}.required references missing property '${r}'` };
        }
      }
    }
  }
  if (Array.isArray(n.enum) && n.enum.length === 0) {
    return { valid: false, reason: `${path}.enum is empty` };
  }
  return { valid: true };
}

/**
 * Validate a single OpenAI tool definition (top-level shape + recursive schema).
 * Malformed tools are dropped individually so a broken Sheets schema can never
 * again break Gmail.
 */
function isValidToolSchema(tool: ToolDef): { valid: boolean; reason?: string } {
  try {
    if (!tool || tool.type !== "function") return { valid: false, reason: "missing type:function" };
    const fn = tool.function;
    if (!fn || typeof fn.name !== "string" || fn.name.length === 0) return { valid: false, reason: "missing function.name" };
    if (typeof fn.description !== "string") return { valid: false, reason: "missing description" };
    const params = fn.parameters as Record<string, unknown> | undefined;
    if (!params || typeof params !== "object") return { valid: false, reason: "missing parameters object" };
    if (params.type !== "object") return { valid: false, reason: "parameters.type must be 'object'" };
    const r = validateJsonSchema(params, `${fn.name}.parameters`);
    if (!r.valid) return r;
    JSON.stringify(tool);
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

let _validatedTools: ToolDef[] | null = null;
let _droppedTools: string[] = [];
function getValidatedTools(): ToolDef[] {
  if (_validatedTools) return _validatedTools;
  const valid: ToolDef[] = [];
  const dropped: string[] = [];
  for (const t of ACTION_TOOLS) {
    const r = isValidToolSchema(t);
    if (r.valid) valid.push(t);
    else {
      dropped.push(t?.function?.name ?? "<unnamed>");
      console.warn(`[tool-guard] DROPPED legacy '${t?.function?.name}': ${r.reason}`);
    }
  }
  _validatedTools = valid;
  _droppedTools = dropped;
  console.log(`[tool-guard] legacy: ${valid.length}/${ACTION_TOOLS.length} validated`);
  return valid;
}

/**
 * Final assembled-list quarantine. Run immediately before tools go to OpenAI.
 * Every tool — legacy, manifest, multi_action — passes through here. One bad
 * apple is dropped; the rest ship.
 */
let _quarantineSummary: { live: number; quarantined: { name: string; reason: string }[] } = { live: 0, quarantined: [] };
function quarantineFinalToolList(tools: ToolDef[]): ToolDef[] {
  const live: ToolDef[] = [];
  const quarantined: { name: string; reason: string }[] = [];
  for (const t of tools) {
    const r = isValidToolSchema(t);
    if (r.valid) live.push(t);
    else {
      const name = t?.function?.name ?? "<unnamed>";
      quarantined.push({ name, reason: r.reason ?? "unknown" });
      console.warn(`[tool-guard] QUARANTINED '${name}': ${r.reason}`);
    }
  }
  _quarantineSummary = { live: live.length, quarantined };
  console.log(`[tool-guard] final: live=${live.length} quarantined=${quarantined.length}`);
  return live;
}

export function getRegistryHealth() {
  return {
    legacyDropped: _droppedTools,
    live: _quarantineSummary.live,
    quarantined: _quarantineSummary.quarantined,
  };
}

// ============================================================================
// DETERMINE WHICH TOOLS ARE AVAILABLE BASED ON CONNECTIONS
// ============================================================================

// Service → domain mapping (Tool Sectioning v2). Used to gate tool exposure
// per turn based on the Infinity Router's domain classification.
const SERVICE_TO_DOMAIN: Record<string, string> = {
  'google-mail': 'google-workspace',
  'google-calendar': 'google-workspace',
  'google-drive': 'google-workspace',
  'google-docs': 'google-workspace',
  'google-sheets': 'google-workspace',
  'google-slides': 'google-workspace',
  'google-search-console': 'google-marketing',
  'google-analytics': 'google-marketing',
  'google-tag-manager': 'google-marketing',
  'ghl': 'crm',
  'plaid': 'finance',
  // ClickUp tools currently use '_always_' (no auth required at the tool layer);
  // we steer them via name-prefix below so they only load when projects intent fires.
};

// Tools tagged '_always_' that we still want to gate by domain (name-prefix steering).
const NAME_PREFIX_DOMAIN: { prefix: string; domain: string }[] = [
  { prefix: 'clickup', domain: 'projects' },
  { prefix: 'higgsfield_', domain: 'creative' },
  { prefix: 'generate_image', domain: 'creative' },
  { prefix: 'edit_image', domain: 'creative' },
  { prefix: 'generate_video', domain: 'creative' },
  { prefix: 'upload_youtube_video', domain: 'creative' },
  { prefix: 'save_memory', domain: 'memory' },
  { prefix: 'search_wisdom_memories', domain: 'memory' },
  { prefix: 'add_standing_order', domain: 'memory' },
  { prefix: 'remove_standing_order', domain: 'memory' },
  { prefix: 'update_standing_order', domain: 'memory' },
  { prefix: 'update_memory', domain: 'memory' },
  { prefix: 'add_goal', domain: 'memory' },
  { prefix: 'update_goal_progress', domain: 'memory' },
  { prefix: 'complete_goal', domain: 'memory' },
];

// 'system' tools are ALWAYS loaded regardless of router domain decisions.
const SYSTEM_TOOL_NAMES = new Set<string>([
  'web_search_google',
  'deep_research',
  'scrape_events',
  'list_events',
  'create_work_task',
  'update_work_task',
  'bulk_update_work_tasks',
]);

/** Filter the AI tool list down to GHL tools the active sub-account's token actually has scopes for.
 *  No-op if scopes are unknown (legacy sub-account never verified) — preserves existing behavior. */
function applyGhlScopeFilter(tools: ToolDef[], grantedScopes: string[] | undefined): ToolDef[] {
  if (!grantedScopes || grantedScopes.length === 0) return tools;
  // Single source of truth: GHL_TOOL_REQUIRED_SCOPES from _shared/integrations/ghl-scopes.ts.
  // No inline duplication — adding a new GHL tool only requires updating that one registry.
  const granted = new Set(grantedScopes);
  return tools.filter((t) => {
    const name = t.function.name;
    if (!name.startsWith('ghl_')) return true;
    const req = GHL_TOOL_REQUIRED_SCOPES[name];
    if (!req || req.length === 0) return true; // unmapped GHL tool → permissive
    return req.every((s) => granted.has(s));
  });
}

function getAvailableTools(connMap: MultiConnMap, hasGHLOverride?: boolean, allowedDomains?: string[]): ToolDef[] {
  const hasGHL = hasGHLOverride !== undefined ? hasGHLOverride : !!Deno.env.get('GHL_API_KEY');

  const toolToService: Record<string, string> = {
    'send_email': 'google-mail',
    'create_email_draft': 'google-mail',
    'list_emails': 'google-mail',
    'get_email': 'google-mail',
    'trash_email': 'google-mail',
    'batch_trash_emails': 'google-mail',
    'list_email_ids': 'google-mail',
    'label_email': 'google-mail',
    'mark_email_read': 'google-mail',
    'create_calendar_event': 'google-calendar',
    'calendar_list_calendars': 'google-calendar',
    'calendar_list_events': 'google-calendar',
    'calendar_get_event': 'google-calendar',
    'calendar_update_event': 'google-calendar',
    'calendar_delete_event': 'google-calendar',
    'calendar_quick_add': 'google-calendar',
    'calendar_freebusy': 'google-calendar',
    'calendar_find_free_slots': 'google-calendar',
    'calendar_move_event': 'google-calendar',
    'calendar_respond_to_event': 'google-calendar',
    'calendar_add_attendees': 'google-calendar',
    'calendar_create_event_with_meet': 'google-calendar',
    'calendar_create_calendar': 'google-calendar',
    'calendar_set_event_reminders': 'google-calendar',
    'calendar_list_colors': 'google-calendar',
    'search_google_drive': 'google-drive',
    'create_google_doc': 'google-drive',
    'create_google_sheet': 'google-drive',
    'read_sheet_data': 'google-drive',
    'append_sheet_rows': 'google-drive',
    'create_google_presentation': 'google-drive',
    'drive_list_files': 'google-drive',
    'drive_get_file': 'google-drive',
    'drive_create_folder': 'google-drive',
    'drive_move_file': 'google-drive',
    'drive_copy_file': 'google-drive',
    'drive_rename_file': 'google-drive',
    'drive_trash_file': 'google-drive',
    'drive_untrash_file': 'google-drive',
    'drive_share_file': 'google-drive',
    'drive_list_permissions': 'google-drive',
    'drive_remove_permission': 'google-drive',
    'drive_storage_quota': 'google-drive',
    'docs_list_documents': 'google-docs',
    'docs_get_document': 'google-docs',
    'docs_insert_text': 'google-docs',
    'docs_replace_text': 'google-docs',
    'docs_batch_update': 'google-docs',
    'docs_apply_markdown': 'google-docs',
    'docs_format_as_report': 'google-docs',
    'docs_style_range': 'google-docs',
    'docs_clear_formatting': 'google-docs',
    'sheets_list_spreadsheets': 'google-sheets',
    'sheets_get_spreadsheet': 'google-sheets',
    'sheets_read_range': 'google-sheets',
    'sheets_write_range': 'google-sheets',
    'sheets_append_rows': 'google-sheets',
    'sheets_clear_range': 'google-sheets',
    'sheets_create_spreadsheet': 'google-sheets',
    'sheets_add_sheet': 'google-sheets',
    'sheets_delete_sheet': 'google-sheets',
    'sheets_get_values_batch': 'google-sheets',
    'sheets_batch_update': 'google-sheets',
    'slides_list_presentations': 'google-slides',
    'slides_get_presentation': 'google-slides',
    'slides_add_slide': 'google-slides',
    'slides_delete_slide': 'google-slides',
    'slides_replace_text': 'google-slides',
    'slides_batch_update': 'google-slides',
    'slides_get_thumbnail': 'google-slides',
    'create_clickup_task': '_always_',
    'list_clickup_tasks': '_always_',
    'get_clickup_task': '_always_',
    'update_clickup_task': '_always_',
    'delete_clickup_task': '_always_',
    'set_clickup_task_status': '_always_',
    'set_clickup_due_date': '_always_',
    'set_clickup_assignees': '_always_',
    'create_clickup_subtask': '_always_',
    'create_clickup_comment': '_always_',
    'list_clickup_comments': '_always_',
    'update_clickup_comment': '_always_',
    'delete_clickup_comment': '_always_',
    'add_clickup_tag': '_always_',
    'remove_clickup_tag': '_always_',
    'create_clickup_checklist': '_always_',
    'create_clickup_checklist_item': '_always_',
    'update_clickup_checklist_item': '_always_',
    'search_clickup_tasks': '_always_',
    'list_clickup_spaces': '_always_',
    'list_clickup_lists': '_always_',
    'list_clickup_members': '_always_',
    'move_clickup_task': '_always_',
    'set_clickup_priority': '_always_',
    'start_clickup_timer': '_always_',
    'stop_clickup_timer': '_always_',
    'get_clickup_time_entries': '_always_',
    'get_clickup_custom_fields': '_always_',
    'set_clickup_custom_field': '_always_',
    'list_clickup_task_dependencies': '_always_',
    'add_clickup_dependency': '_always_',
    'delete_clickup_dependency': '_always_',
    'delete_clickup_checklist': '_always_',
    'delete_clickup_checklist_item': '_always_',
    'get_clickup_list_statuses': '_always_',
    // GHL tools
    'ghl_list_contacts': 'ghl',
    'ghl_create_contact': 'ghl',
    'ghl_create_opportunity': 'ghl',
    'ghl_list_opportunities': 'ghl',
    'ghl_list_pipelines': 'ghl',
    'ghl_send_message': 'ghl',
    'ghl_list_calendars': 'ghl',
    'ghl_book_appointment': 'ghl',
    'ghl_add_tags': 'ghl',
    'ghl_list_workflows': 'ghl',
    'ghl_list_campaigns': 'ghl',
    'ghl_get_contact': 'ghl',
    'ghl_update_contact': 'ghl',
    'ghl_search_contacts': 'ghl',
    'ghl_update_opportunity': 'ghl',
    'ghl_get_calendar_events': 'ghl',
    'ghl_get_free_slots': 'ghl',
    'ghl_list_conversations': 'ghl',
    'ghl_get_conversation_messages': 'ghl',
    'ghl_list_invoices': 'ghl',
    'ghl_create_invoice': 'ghl',
    'ghl_list_orders': 'ghl',
    'ghl_list_transactions': 'ghl',
    'ghl_list_forms': 'ghl',
    'ghl_get_form_submissions': 'ghl',
    'ghl_list_funnels': 'ghl',
    'ghl_list_custom_fields': 'ghl',
    'ghl_list_custom_values': 'ghl',
    'ghl_list_users': 'ghl',
    'ghl_list_tags': 'ghl',
    'ghl_delete_contact': 'ghl',
    'ghl_add_contact_note': 'ghl',
    'ghl_list_contact_notes': 'ghl',
    'ghl_add_contact_task': 'ghl',
    'ghl_list_contact_tasks': 'ghl',
    'ghl_remove_tags': 'ghl',
    'ghl_cancel_appointment': 'ghl',
    'ghl_update_appointment': 'ghl',
    'ghl_trigger_workflow': 'ghl',
    // Tier 3 GHL tools
    'ghl_list_social_accounts': 'ghl',
    'ghl_list_social_posts': 'ghl',
    'ghl_create_social_post': 'ghl',
    'ghl_delete_social_post': 'ghl',
    'ghl_list_products': 'ghl',
    'ghl_get_product': 'ghl',
    'ghl_create_product': 'ghl',
    'ghl_update_product': 'ghl',
    'ghl_delete_product': 'ghl',
    'ghl_list_courses': 'ghl',
    'ghl_list_surveys': 'ghl',
    'ghl_get_survey_submissions': 'ghl',
    'ghl_list_blog_sites': 'ghl',
    'ghl_list_blog_posts': 'ghl',
    'ghl_get_blog_post': 'ghl',
    'ghl_create_blog_post': 'ghl',
    'ghl_update_blog_post': 'ghl',
    'ghl_delete_blog_post': 'ghl',
    'ghl_list_media_files': 'ghl',
    'ghl_upload_media_file': 'ghl',
    'ghl_list_companies': 'ghl',
    'ghl_get_company': 'ghl',
    'ghl_list_links': 'ghl',
    'ghl_create_link': 'ghl',
    'ghl_list_businesses': 'ghl',
    'ghl_get_business': 'ghl',
    // Edit 1 — previously-unexposed
    'ghl_get_conversation': 'ghl',
    'ghl_get_invoice': 'ghl',
    'ghl_get_opportunity': 'ghl',
    'ghl_get_social_post': 'ghl',
    'ghl_edit_social_post': 'ghl',
    'ghl_update_link': 'ghl',
    'ghl_import_courses': 'ghl',
    'ghl_create_appointment': 'ghl',
    // Tier A — new
    'ghl_delete_opportunity': 'ghl',
    'ghl_update_opportunity_status': 'ghl',
    'ghl_update_contact_note': 'ghl',
    'ghl_delete_contact_note': 'ghl',
    'ghl_update_contact_task': 'ghl',
    'ghl_complete_contact_task': 'ghl',
    'ghl_delete_contact_task': 'ghl',
    'ghl_remove_from_workflow': 'ghl',
    // Tier B
    'ghl_create_custom_field': 'ghl',
    'ghl_update_custom_field': 'ghl',
    'ghl_delete_custom_field': 'ghl',
    'ghl_create_custom_value': 'ghl',
    'ghl_update_custom_value': 'ghl',
    'ghl_delete_custom_value': 'ghl',
    'ghl_create_tag': 'ghl',
    'ghl_delete_tag': 'ghl',
    'ghl_list_calendar_groups': 'ghl',
    'ghl_list_calendar_resources': 'ghl',
    'ghl_block_calendar_slot': 'ghl',
    'ghl_get_user': 'ghl',
    'ghl_create_user': 'ghl',
    'ghl_update_user': 'ghl',
    // Tier C
    'ghl_list_locations': 'ghl',
    'ghl_get_location': 'ghl',
    'ghl_update_location': 'ghl',
    'ghl_list_snapshots': 'ghl',
    'ghl_get_order': 'ghl',
    'ghl_get_transaction': 'ghl',
    'ghl_list_subscriptions': 'ghl',
    'ghl_get_subscription': 'ghl',
    'ghl_list_prices': 'ghl',
    'ghl_create_price': 'ghl',
    'ghl_update_price': 'ghl',
    // (duplicate 'ghl_upload_media_file' removed — defined above at line 6558)
    'ghl_delete_media_file': 'ghl',
    'ghl_list_sub_accounts': 'ghl',
    'ghl_set_active_sub_account': 'ghl',
    'ghl_set_default_sub_account': 'ghl',
    'ghl_check_capability': 'ghl',
    'ghl_smart_search': 'ghl',
    // GSC / SEO tools
    'gsc_list_sites': 'google-search-console',
    'gsc_query': 'google-search-console',
    'gsc_save_snapshot': 'google-search-console',
    'gsc_compare_snapshots': 'google-search-console',
    'searchatlas_audit_site': '_always_',
    'searchatlas_site_explorer': '_always_',
    'searchatlas_keyword_research': '_always_',
    'searchatlas_serp_snapshot': '_always_',
    'searchatlas_backlinks_overview': '_always_',
    'searchatlas_backlinks_list': '_always_',
    'searchatlas_list_projects': '_always_',
    'searchatlas_rank_tracker': '_always_',
    'web_search_google': '_always_',
    'save_memory': '_always_',
    'search_wisdom_memories': '_always_',
    'add_standing_order': '_always_',
    'remove_standing_order': '_always_',
    'update_standing_order': '_always_',
    'update_memory': '_always_',
    'add_goal': '_always_',
    'update_goal_progress': '_always_',
    'complete_goal': '_always_',
    'deep_research': '_always_',
    'scrape_events': '_always_',
    'list_events': '_always_',
    'create_work_task': '_always_',
    'update_work_task': '_always_',
    'bulk_update_work_tasks': '_always_',
    'upload_youtube_video': '_always_',
    'higgsfield_generate_image': '_always_',
    'higgsfield_generate_video': '_always_',
    'higgsfield_get_job_status': '_always_',
    'higgsfield_cancel_job': '_always_',
    'generate_image': '_always_',
    'edit_image': '_always_',
    'generate_video': '_always_',
  };

  // Use the validated tool array — broken schemas have already been dropped.
  const validated = getValidatedTools();

  // Step 1: connection-based filter (existing behavior)
  const connectionFiltered = validated.filter(tool => {
    const requiredService = toolToService[tool.function.name];
    if (requiredService === 'ghl') return hasGHL;
    if (requiredService === '_always_') return true;
    return requiredService ? connMap.has(requiredService) : true;
  });

  // Step 2: Tool Sectioning v2 — domain gating
  // If allowedDomains is undefined (router off / fallback / low confidence),
  // skip gating entirely → identical to v1 behavior. Zero regression risk.
  let filtered = connectionFiltered;
  let domainGateApplied = false;
  if (allowedDomains && allowedDomains.length > 0) {
    const domainSet = new Set(allowedDomains);
    domainSet.add('system'); // always include system tools
    filtered = connectionFiltered.filter(tool => {
      const name = tool.function.name;
      // Always-on system tools
      if (SYSTEM_TOOL_NAMES.has(name)) return true;
      const svc = toolToService[name];
      // Map service → domain
      if (svc && svc !== '_always_') {
        const domain = SERVICE_TO_DOMAIN[svc];
        if (domain) return domainSet.has(domain);
      }
      // '_always_' or unmapped → check name-prefix steering
      const prefixMatch = NAME_PREFIX_DOMAIN.find(p => name.startsWith(p.prefix));
      if (prefixMatch) return domainSet.has(prefixMatch.domain);
      // Unscoped fallback: keep it (safer to over-include than drop a real tool)
      return true;
    });
    domainGateApplied = true;
  }

  // Per-domain distribution log — observability for the sectioning plan.
  const byDomain: Record<string, number> = {};
  for (const t of filtered) {
    const svc = toolToService[t.function.name] || 'unscoped';
    byDomain[svc] = (byDomain[svc] || 0) + 1;
  }
  console.log(
    `[tool-sections] ${filtered.length}/${connectionFiltered.length} tools loaded. ` +
    `Gate=${domainGateApplied ? `[${allowedDomains?.join(',')}]` : 'OFF'}. By service:`, byDomain
  );
  if (_droppedTools.length > 0) {
    console.warn(`[tool-sections] ${_droppedTools.length} tool(s) permanently disabled (bad schema):`, _droppedTools);
  }

  // ===== Registry-driven tools (manifests in _shared/integrations/) =====
  // Registry takes PRECEDENCE over legacy hardcoded tool defs: if a tool name
  // is registered via a manifest, the manifest schema wins (legacy version is
  // dropped from OpenAI tool defs). Execution-side, the dispatcher already
  // short-circuits the legacy switch, so this keeps the two layers in sync.
  // Adding a new integration manifest automatically surfaces its tools here.
  const registered = getAllRegisteredTools();
  const registeredNames = new Set(registered.map((t) => t.name));
  filtered = filtered.filter((t) => !registeredNames.has(t.function.name));
  const existingNames = new Set(filtered.map((t) => t.function.name));
  for (const t of registered) {
    if (existingNames.has(t.name)) continue;
    filtered.push({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema as Record<string, unknown>,
      },
    } as ToolDef);
  }
  if (!existingNames.has("multi_action")) {
    filtered.push({
      type: "function",
      function: {
        name: "multi_action",
        description:
          "Run multiple tool calls in PARALLEL. Use whenever the user asks for several independent actions in one request " +
          "(e.g. 'send the email, log it in CRM, and add a row to the tracker'). Returns per-call success/failure.",
        parameters: {
          type: "object",
          properties: {
            calls: {
              type: "array",
              minItems: 2,
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Tool name to invoke" },
                  args: { type: "object", description: "Arguments object for that tool" },
                },
                required: ["name", "args"],
              },
            },
          },
          required: ["calls"],
        },
      },
    } as ToolDef);
  }

  // ---- load_skill: progressive skill loader (Skills Platform) ----
  if (!existingNames.has("load_skill")) {
    filtered.push({
      type: "function",
      function: {
        name: "load_skill",
        description:
          "Activate a user-installed Skill by its slug. Returns the skill's full instructions and the list of tools it expects to use. " +
          "Call this AS SOON AS you recognize a request matches one of the installed skills listed in the system prompt — do not improvise the workflow when a skill exists for it.",
        parameters: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "The slug of the installed skill, e.g. 'email-triage'.",
            },
          },
          required: ["slug"],
        },
      },
    } as ToolDef);
  }

  // ---- update_skill: patch instructions or manifest of an installed skill ----
  if (!existingNames.has("update_skill")) {
    filtered.push({
      type: "function",
      function: {
        name: "update_skill",
        description:
          "Durably modify an installed Skill (instructions or manifest fields). Use this INSTEAD of saving 'remember to do X with skill Y' as a memory. " +
          "If the skill is builtin/imported, a private fork is auto-created and your install is rebound to it. Every edit bumps the skill version and is audited. " +
          "Provide either `content` (with optional `merge_strategy` and `section`) to patch instructions, OR `manifest_patch` to update structured fields.",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Slug of the installed skill to edit." },
            content: { type: "string", description: "Markdown content to merge into the skill instructions." },
            merge_strategy: {
              type: "string",
              enum: ["append", "prepend", "replace_section"],
              description: "How to merge `content`. Default: append.",
            },
            section: {
              type: "string",
              description: "Section header name (without '## ') when merge_strategy is 'replace_section'.",
            },
            manifest_patch: {
              type: "object",
              description: "Whitelisted manifest fields to update: name, description, triggers, tools_required, tools_optional, memory_domains, modes_allowed, requires_confirmation.",
              additionalProperties: true,
            },
          },
          required: ["slug"],
        },
      },
    } as ToolDef);
  }

  // ---- add_skill_prerequisites: convenience tool to append a Prerequisites block ----
  if (!existingNames.has("add_skill_prerequisites")) {
    filtered.push({
      type: "function",
      function: {
        name: "add_skill_prerequisites",
        description:
          "Append durable prerequisites to an installed Skill so future runs inherit them at the skill level. " +
          "Prefer this over saving 'always do X when using skill Y' as a memory.",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Slug of the installed skill, e.g. 'higgsfield-ad-director'." },
            prerequisites: {
              type: "array",
              items: { type: "string" },
              description: "Bullet items to add under a '## Prerequisites' section at the top of the skill.",
            },
          },
          required: ["slug", "prerequisites"],
        },
      },
    } as ToolDef);
  }

  // Drops any individually malformed tool (legacy, manifest, or multi_action)
  // so one bad schema can never again poison the entire payload.
  return quarantineFinalToolList(filtered);
}

// ============================================================================
// NON-STREAMING TOOL LOOP - For when tools need to be called
// Now emits task_update SSE events for frontend visibility
// ============================================================================

interface TaskUpdateEvent {
  taskId: string;
  title: string;
  step: string;
  status: 'in_progress' | 'done' | 'error';
  summary?: string;
}

// ============================================================================
// STREAMING WEB INVESTIGATE — auto-upgrade web_investigate tool calls to the
// SSE variant (web_investigate_stream) and forward each event as a task_update
// to the chat client. Falls back to null on any error so caller can use the
// blocking dispatcher path.
// ============================================================================
async function streamWebInvestigate(
  args: Record<string, unknown>,
  authHeader: string,
  taskId: string,
  emit: (e: TaskUpdateEvent) => void | Promise<void>,
): Promise<{ success: boolean; result: string; structured?: Record<string, unknown> } | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return null;

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/research`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'apikey': anonKey,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        action: 'web_investigate_stream',
        params: {
          query: args.query,
          contextHint: args.contextHint,
        },
      }),
    });
  } catch (e) {
    console.warn('[streamWebInvestigate] fetch failed:', e);
    return null;
  }

  if (!res.ok || !res.body) {
    console.warn(`[streamWebInvestigate] bad response: ${res.status}`);
    return null;
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    // Stream variant not supported — let blocking path handle it.
    return null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let currentEvent = 'message';
  let finalPayload: Record<string, unknown> | null = null;
  let errorMsg: string | null = null;
  const subQueryCount: { n: number } = { n: 0 };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith(':')) continue;
        if (t.startsWith('event: ')) {
          currentEvent = t.slice(7).trim();
          continue;
        }
        if (!t.startsWith('data: ')) continue;
        const dataStr = t.slice(6);
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(dataStr); } catch { continue; }

        // Map SSE events → task_update steps
        try {
          switch (currentEvent) {
            case 'started':
              await emit({ taskId, title: '', step: 'Planning investigation', status: 'in_progress' });
              break;
            case 'recall_hit':
              await emit({ taskId, title: '', step: 'Found recent matching investigation', status: 'done' });
              break;
            case 'plan_ready': {
              const subs = Array.isArray(data.sub_queries) ? data.sub_queries.length : 0;
              await emit({ taskId, title: '', step: `Planned ${subs} sub-quer${subs === 1 ? 'y' : 'ies'}`, status: 'done' });
              break;
            }
            case 'subquery_done': {
              subQueryCount.n += 1;
              const q = (data.query as string) || `sub-query ${subQueryCount.n}`;
              const short = q.length > 60 ? q.slice(0, 57) + '…' : q;
              await emit({ taskId, title: '', step: `Searched: ${short}`, status: 'done' });
              break;
            }
            case 'enrich_start':
              await emit({ taskId, title: '', step: 'Reading top sources', status: 'in_progress' });
              break;
            case 'enrich_done': {
              const n = (data.document_count as number) ?? 0;
              await emit({ taskId, title: '', step: `Read ${n} document${n === 1 ? '' : 's'}`, status: 'done' });
              break;
            }
            case 'synthesis_start':
              await emit({ taskId, title: '', step: 'Synthesizing answer', status: 'in_progress' });
              break;
            case 'critique_done':
              await emit({ taskId, title: '', step: 'Self-critique complete', status: 'done' });
              break;
            case 'done':
              finalPayload = data;
              break;
            case 'error':
              errorMsg = (data.error as string) || 'Investigation stream error';
              break;
          }
        } catch (e) {
          console.warn('[streamWebInvestigate] emit failed:', e);
        }
        currentEvent = 'message';
      }
    }
  } catch (e) {
    console.warn('[streamWebInvestigate] read loop error:', e);
    return null;
  }

  if (errorMsg && !finalPayload) {
    return { success: false, result: `Investigation failed: ${errorMsg}` };
  }
  if (!finalPayload) {
    return null; // incomplete — let caller fall back
  }

  // Format final payload using the same shape web_investigate returns.
  const d = finalPayload as {
    answer?: string;
    citations?: Array<{ index: number; url: string; title: string }>;
    sub_queries?: Array<{ query: string; intent: string }>;
    confidence?: number;
    gaps?: string[];
  };
  if (!d.answer) return { success: false, result: 'No investigation completed.' };
  const subs = (d.sub_queries ?? []).map((s, i) => `  ${i + 1}. [${s.intent}] ${s.query}`).join('\n');
  const cites = (d.citations ?? []).map((c) => `[${c.index}] ${c.title} — ${c.url}`).join('\n');
  const gaps = d.gaps && d.gaps.length > 0 ? `\n\nKnown gaps:\n${d.gaps.map((g) => `• ${g}`).join('\n')}` : '';
  const conf = typeof d.confidence === 'number' ? ` (confidence: ${(d.confidence * 100).toFixed(0)}%)` : '';
  const body = `${d.answer}${conf}\n\nSub-queries run:\n${subs}${cites ? `\n\nSources:\n${cites}` : ''}${gaps}`;
  return { success: true, result: body, structured: { ...d, question: (args.query as string) || '', delivered_via: 'stream' } };
}

// Human-readable tool names for display
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'list_emails': 'Fetching emails',
  'list_email_ids': 'Scanning email IDs',
  'get_email': 'Reading email',
  'trash_email': 'Moving email to trash',
  'batch_trash_emails': 'Batch trashing emails',
  'label_email': 'Updating email labels',
  'mark_email_read': 'Marking email as read',
  'send_email': 'Sending email',
  'create_email_draft': 'Creating email draft',
  'create_calendar_event': 'Creating calendar event',
  'search_google_drive': 'Searching Google Drive',
  'create_google_doc': 'Creating Google Doc',
  'docs_apply_markdown': 'Styling Google Doc',
  'docs_format_as_report': 'Formatting as report',
  'docs_style_range': 'Styling text range',
  'docs_clear_formatting': 'Clearing formatting',
  'create_google_sheet': 'Creating Google Sheet',
  'ghl_list_contacts': 'Listing GHL contacts',
  'ghl_create_contact': 'Creating GHL contact',
  'ghl_send_message': 'Sending GHL message',
  'gsc_list_sites': 'Listing GSC sites',
  'gsc_query': 'Querying Search Console',
  'gsc_save_snapshot': 'Saving SEO snapshot',
  'gsc_compare_snapshots': 'Loading SEO snapshots',
  'searchatlas_audit_site': 'Auditing site',
  'searchatlas_site_explorer': 'Exploring domain',
  'searchatlas_keyword_research': 'Researching keywords',
  'searchatlas_serp_snapshot': 'Snapshotting SERP',
  'searchatlas_backlinks_overview': 'Loading backlinks overview',
  'searchatlas_backlinks_list': 'Listing backlinks',
  'searchatlas_list_projects': 'Listing rank-tracker projects',
  'searchatlas_rank_tracker': 'Loading tracked rankings',
  'web_search_google': 'Searching Google',
  'save_memory': 'Saving to memory',
  'search_wisdom_memories': 'Recalling memory',
  'add_standing_order': 'Setting standing order',
  'remove_standing_order': 'Removing standing order',
  'update_standing_order': 'Updating standing order',
  'update_memory': 'Updating memory',
  'add_goal': 'Tracking new goal',
  'update_goal_progress': 'Logging goal progress',
  'complete_goal': 'Completing goal',
  'deep_research': 'Researching the web',
  'scrape_events': 'Searching for events',
  'list_events': 'Loading your events',
  'create_work_task': 'Creating work task',
  'update_work_task': 'Updating work task',
  'bulk_update_work_tasks': 'Updating work tasks',
  'upload_youtube_video': 'Uploading to YouTube',
};

function inferTaskTitle(toolNames: string[]): string {
  if (toolNames.some(n => n.includes('trash') || n.includes('label') || n === 'list_emails')) return 'Managing emails';
  if (toolNames.some(n => n.includes('email') || n.includes('mail'))) return 'Handling email';
  if (toolNames.some(n => n.includes('calendar'))) return 'Managing calendar';
  if (toolNames.some(n => n.startsWith('ghl_'))) return 'Working in GoHighLevel';
  if (toolNames.some(n => n.includes('youtube'))) return 'Working with YouTube';
  if (toolNames.some(n => n.includes('google'))) return 'Working in Google';
  if (toolNames.some(n => n.includes('event'))) return 'Finding events';
  return 'Executing task';
}

// ============================================================================
// PHASE 3 — PLANNER PASS (Two-Pass Agentic Routing)
// Quick gpt-5-mini call that produces a structured plan {intent, steps[], integrations[]}.
// The plan is fed back into the prioritizer (as serviceIntents) so the executor only
// loads relevant tools, and steps are streamed to the UI as task_update events.
// Fully optional — any failure falls back silently to the existing single-pass flow.
// ============================================================================

interface AgenticPlan {
  intent: string;
  steps: string[];
  integrations: string[];
  needsTools: boolean;
}

// Map planner integration labels to the same buckets the prioritizer uses.
// Returned values match `intentToBucket` keys (serviceIntents) so they slot in directly.
const PLAN_INTEGRATION_TO_INTENT: Record<string, string> = {
  'ghl': 'gohighlevel', 'gohighlevel': 'gohighlevel', 'highlevel': 'gohighlevel',
  'gmail': 'google-mail', 'mail': 'google-mail', 'email': 'google-mail',
  'calendar': 'google-calendar', 'gcal': 'google-calendar',
  'drive': 'google-drive',
  'docs': 'google-docs', 'doc': 'google-docs',
  'sheets': 'google-sheets', 'sheet': 'google-sheets',
  'slides': 'google-slides',
  'gsc': 'google-search-console', 'search-console': 'google-search-console', 'seo': 'google-search-console',
  'analytics': 'google-analytics-data', 'ga4': 'google-analytics-data',
  'meet': 'google-meet',
  'youtube': 'youtube', 'yt': 'youtube',
  'clickup': 'clickup',
};

// Conversational fast-path patterns — bypass planner entirely (zero added latency).
const CHITCHAT_PATTERNS = /^(hi|hey|hello|yo|sup|thanks?|thank you|ty|cool|nice|ok|okay|got it|gotcha|good|great|lol|haha|bye|cya|gn|gm|good morning|good night|what'?s up|how are you|who are you|what can you do|help)[\s!?.]*$/i;

function shouldSkipPlanner(userMessage: string): boolean {
  const trimmed = (userMessage || '').trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 40 && CHITCHAT_PATTERNS.test(trimmed)) return true;
  return false;
}

async function runPlannerPass(
  apiKey: string,
  userMessage: string,
  proactiveMemoryBlock: string | null,
  prefs: UserPrefs = DEFAULT_PREFS,
  supabaseClient?: any,
  userId?: string,
  registry: Record<string, ModelEntry> = MODEL_REGISTRY_BASE,
): Promise<AgenticPlan | null> {
  const knownIntegrations = Object.keys(PLAN_INTEGRATION_TO_INTENT)
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .join(', ');

  const sys = `You are a fast routing planner for an AI personal assistant. Given a user request, output a compact JSON plan describing what the executor agent must do.

Output ONLY valid JSON with this exact shape (no prose, no code fence):
{"intent":"...","steps":["..."],"integrations":["..."],"needsTools":true|false}

Rules:
- "intent": 2-6 words describing the user's goal.
- "steps": 1-5 short imperative phrases (max 8 words each). These render in the user's task panel.
- "integrations": pick ONLY from this list: ${knownIntegrations}. Empty array if none needed.
- "needsTools": true if the request requires calling external services or actions; false for pure conversation, opinion, recall.
- Be conservative — only list integrations you're confident are required.`;

  const userBlock = proactiveMemoryBlock
    ? `Relevant memory:\n${proactiveMemoryBlock.slice(0, 1500)}\n\nUser request:\n${userMessage}`
    : `User request:\n${userMessage}`;

  try {
    const result = await callWithFallback({
      apiKey,
      agent: 'planner',
      prefs,
      registry,
      timeoutMs: 4000,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userBlock },
      ],
      body: {
        max_completion_tokens: 300,
      },
    });

    // Fire-and-forget telemetry
    if (supabaseClient && userId) {
      logRouting(supabaseClient, userId, 'planner', result, { mode: prefs.mode });
    }

    if (!result.ok || !result.data) {
      console.warn('[Planner] gateway not ok:', result.status, result.errorCode);
      return null;
    }
    const raw = result.data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    // Tolerate code fences / leading text — extract first {...} block.
    const cleaned = String(raw).replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const plan: AgenticPlan = {
      intent: String(parsed.intent || '').slice(0, 120),
      steps: Array.isArray(parsed.steps) ? parsed.steps.map((s: unknown) => String(s).slice(0, 80)).slice(0, 6) : [],
      integrations: Array.isArray(parsed.integrations)
        ? parsed.integrations.map((s: unknown) => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 8)
        : [],
      needsTools: parsed.needsTools !== false,
    };
    if (!plan.intent && plan.steps.length === 0 && plan.integrations.length === 0) return null;
    return plan;
  } catch (e) {
    console.warn('[Planner] failed, falling back:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Translate planner integration buckets into the same `serviceIntents` strings
// the prioritizer already understands. Unknown buckets are dropped.
function planToServiceIntents(plan: AgenticPlan): string[] {
  const out = new Set<string>();
  for (const bucket of plan.integrations) {
    const intent = PLAN_INTEGRATION_TO_INTENT[bucket];
    if (intent) out.add(intent);
  }
  return [...out];
}

async function runToolLoop(
  modelConfig: ModelConfig,
  apiKey: string,
  openAIMessages: { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[],
  tools: ToolDef[],
  connMap: MultiConnMap,
  maxIterations = 20,
  onTaskUpdate?: (event: TaskUpdateEvent) => void | Promise<void>,
  userMessage?: string,
  aliasMap?: AliasEntry[],
  userId?: string | null,
  ghlCreds?: { apiKey?: string; locationId?: string; subAccounts?: { id: string; name: string; api_key?: string }[] },
  serviceIntents?: string[],
): Promise<{ role: string; content: string; toolsUsed: string[]; investigations: Array<{ question: string; payload: Record<string, unknown> }>; researchReports: Array<{ reportId: string; query: string; confidence: number }> }> {
  let iteration = 0;
  const taskId = crypto.randomUUID();
  let taskCreated = false;
  const toolsUsed: string[] = [];
  const investigations: Array<{ question: string; payload: Record<string, unknown> }> = [];
  const researchReports: Array<{ reportId: string; query: string; confidence: number }> = [];
  // Reset per-turn GHL guardrail flag (avoid leaking across requests on warm instances).
  (globalThis as Record<string, unknown>).__ghlSwitchedThisTurn = false;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`Tool loop iteration ${iteration}`);

    // OpenAI hard limit: 128 tools per request. Tier-based ranker.
    const MAX_TOOLS = 128;
    let toolsForRequest: ToolDef[] = tools;
    if (tools.length > MAX_TOOLS) {
      const hint = (userMessage || '').toLowerCase();

      // Integration classifier — maps a tool name to a logical integration bucket.
      const integrationOf = (name: string): string => {
        if (name.startsWith('ghl_')) return 'ghl';
        if (name.startsWith('searchatlas_')) return 'search-atlas';
        if (name.startsWith('gsc_')) return 'gsc';
        if (name.includes('clickup')) return 'clickup';
        if (name.includes('youtube')) return 'youtube';
        if (name.includes('calendar') || name.includes('event')) return 'calendar';
        if (name.includes('email') || name.includes('mail') || name.includes('gmail') || name.includes('thread')) return 'gmail';
        if (name.includes('sheet') || name.includes('spreadsheet')) return 'sheets';
        if (name.includes('slide') || name.includes('presentation')) return 'slides';
        if (name.includes('doc')) return 'docs';
        if (name.includes('drive')) return 'drive';
        if (name.includes('analytics') || name.startsWith('ga_')) return 'analytics';
        if (name.includes('meet')) return 'meet';
        if (name.startsWith('higgsfield_') || name.includes('higgsfield')) return 'higgsfield';
        if (name.startsWith('descript_') || name.includes('descript')) return 'descript';
        return 'other';
      };

      // Resolve which integrations are "named" this turn — from explicit serviceIntents
      // (high-confidence) plus keyword fallback in the raw user message.
      const namedIntegrations = new Set<string>();
      const intentToBucket: Record<string, string> = {
        'gohighlevel': 'ghl',
        'google-mail': 'gmail',
        'google-calendar': 'calendar',
        'google-drive': 'drive',
        'google-docs': 'docs',
        'google-sheets': 'sheets',
        'google-slides': 'slides',
        'google-search-console': 'gsc',
        'google-analytics-data': 'analytics',
        'google-meet': 'meet',
        'youtube': 'youtube',
        'clickup': 'clickup',
      };
      for (const intent of serviceIntents || []) {
        const bucket = intentToBucket[intent];
        if (bucket) namedIntegrations.add(bucket);
      }
      // Keyword fallback (broader vocabulary)
      const kwMap: Array<[RegExp, string]> = [
        [/\b(ghl|gohighlevel|high\s*level|pipeline|opportunity|funnel|workflow|appointment|invoice|sub[- ]?account)\b/, 'ghl'],
        [/\b(clickup|task|subtask|sprint|space|folder)\b/, 'clickup'],
        [/\b(email|gmail|inbox|message|thread|reply|draft)\b/, 'gmail'],
        [/\b(calendar|meeting|schedule|appointment)\b/, 'calendar'],
        [/\b(drive|file|folder)\b/, 'drive'],
        [/\b(doc|document)\b/, 'docs'],
        [/\b(sheet|spreadsheet|csv|rows?)\b/, 'sheets'],
        [/\b(slide|deck|presentation)\b/, 'slides'],
        [/\b(youtube|video|channel)\b/, 'youtube'],
        [/\b(seo|search\s*console|gsc|impressions|clicks)\b/, 'gsc'],
        [/\b(analytics|ga4|sessions|pageview)\b/, 'analytics'],
        [/\b(meet|google\s*meet)\b/, 'meet'],
        [/\b(image|generate|render|animate|higgsfield|art|illustration|picture|photo)\b/, 'higgsfield'],
        [/\b(descript|transcript|edit\s*video|voiceover)\b/, 'descript'],
      ];
      for (const [re, bucket] of kwMap) if (re.test(hint)) namedIntegrations.add(bucket);

      // Tier B core tools — always preserved.
      const CORE_TOOLS = new Set([
        'save_memory', 'search_wisdom_memories', 'add_goal', 'update_goal_progress', 'complete_goal',
        'add_standing_order', 'remove_standing_order', 'update_standing_order', 'update_memory',
        'create_routine', 'list_routines', 'toggle_routine', 'delete_routine', 'run_routine_now',
        'create_work_task', 'update_work_task', 'bulk_update_work_tasks',
        'deep_research', 'web_search_google',
      ]);

      // Per-integration soft cap when 2+ named (proportional split).
      const reservedCore = 10;
      const budget = MAX_TOOLS - reservedCore;
      const perIntegrationCap = namedIntegrations.size >= 2
        ? Math.floor(budget / namedIntegrations.size)
        : Infinity;

      // Semantic relevance booster — token overlap between user message and tool name+description.
      // Cheap, no embeddings needed. Adds 0-50 bonus points so semantically relevant tools
      // bubble up *within* their tier, and Tier C tools that match strongly can outscore unmatched Tier C.
      const STOPWORDS = new Set([
        'the','a','an','and','or','but','of','in','on','at','to','for','with','by','from','as','is','are',
        'was','were','be','been','being','have','has','had','do','does','did','will','would','should','could',
        'can','may','might','must','shall','my','me','i','you','your','our','we','it','its','this','that',
        'these','those','what','which','who','how','when','where','why','show','get','give','tell','list','make','please',
      ]);
      const tokenize = (s: string): string[] =>
        s.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !STOPWORDS.has(t));
      const queryTokens = new Set(tokenize(hint));
      const semanticBoost = (name: string, description: string): number => {
        if (queryTokens.size === 0) return 0;
        const toolTokens = new Set([...tokenize(name.replace(/_/g, ' ')), ...tokenize(description)]);
        let overlap = 0;
        for (const t of queryTokens) if (toolTokens.has(t)) overlap++;
        // Cap bonus at 50 — enough to lift a strong-match Tier C tool to ~Tier B level,
        // but not enough to displace a true Tier A integration tool.
        return Math.min(50, overlap * 12);
      };

      const scored = tools.map((t) => {
        const fn = (t as { function?: { name?: string; description?: string } }).function;
        const name = fn?.name || '';
        const description = fn?.description || '';
        const bucket = integrationOf(name);
        let score = 10; // Tier C baseline
        if (CORE_TOOLS.has(name)) score = 100; // Tier B
        if (namedIntegrations.has(bucket)) score = 1000; // Tier A
        score += semanticBoost(name, description);
        return { tool: t, name, bucket, score };
      });
      scored.sort((a, b) => b.score - a.score);

      // Reserved-tool floor: critical "always-discoverable" tools per integration.
      // When the integration is connected (any of its tools exist in the pool), we
      // guarantee these survive the cap even if the turn isn't classified as that
      // integration. Prevents the recurring "ghl_create_custom_field not available"
      // class of bugs after a refactor or a low-confidence classification.
      const RESERVED_TOOLS_BY_BUCKET: Record<string, string[]> = {
        ghl: [
          'ghl_list_custom_fields',
          'ghl_create_custom_field',
          'ghl_update_custom_field',
          'ghl_list_contacts',
          'ghl_search_contacts',
          'ghl_create_contact',
          'ghl_list_pipelines',
          'ghl_list_calendars',
          'ghl_list_workflows',
          'ghl_inspect_capabilities',
        ],
      };
      const reservedFloor = new Set<string>();
      const presentBuckets = new Set(scored.map((s) => s.bucket));
      for (const [bucket, names] of Object.entries(RESERVED_TOOLS_BY_BUCKET)) {
        if (!presentBuckets.has(bucket)) continue;
        for (const n of names) reservedFloor.add(n);
      }

      // Apply per-integration soft cap (Tier A only) so multi-intent turns don't starve.
      const perIntegrationCount: Record<string, number> = {};
      const kept: typeof scored = [];
      const overflow: typeof scored = [];

      // Pass 0: pin reserved-floor tools first so they cannot be evicted.
      const pinned = new Set<string>();
      for (const s of scored) {
        if (reservedFloor.has(s.name)) {
          kept.push(s);
          pinned.add(s.name);
          if (kept.length >= MAX_TOOLS) break;
        }
      }

      for (const s of scored) {
        if (pinned.has(s.name)) continue;
        if (s.score === 1000 && perIntegrationCap !== Infinity) {
          const c = perIntegrationCount[s.bucket] || 0;
          if (c >= perIntegrationCap) {
            overflow.push(s);
            continue;
          }
          perIntegrationCount[s.bucket] = c + 1;
        }
        kept.push(s);
        if (kept.length >= MAX_TOOLS) break;
      }
      // Backfill from overflow if there's still room.
      if (kept.length < MAX_TOOLS) {
        for (const s of overflow) {
          if (pinned.has(s.name)) continue;
          kept.push(s);
          if (kept.length >= MAX_TOOLS) break;
        }
      }
      toolsForRequest = kept.slice(0, MAX_TOOLS).map((s) => s.tool);

      // Telemetry: bucket distribution of what survived the cap.
      const distribution: Record<string, number> = {};
      for (const s of kept.slice(0, MAX_TOOLS)) {
        const key = CORE_TOOLS.has(s.name) ? 'core' : s.bucket;
        distribution[key] = (distribution[key] || 0) + 1;
      }
      console.log(
        `Tools capped ${tools.length}→${toolsForRequest.length}. ` +
        `Named: [${Array.from(namedIntegrations).join(',') || 'none'}]. ` +
        `Reserved-floor pinned: ${pinned.size}. ` +
        `Kept: ${JSON.stringify(distribution)}`,
      );
    }

    // Failover-aware call: rotates through OpenAI direct → Lovable AI gateway
    // (gpt-5.4 → gpt-5 → gemini) until one provider succeeds.
    let response: Response;
    let usedEntry: ChainEntry;
    try {
      const result = await callModelWithFallback(
        chainFor(modelConfig.name),
        (entry) => ({
          model: entry.model,
          messages: openAIMessages,
          max_completion_tokens: modelConfig.maxTokens,
          tools: toolsForRequest.length > 0 ? toolsForRequest : undefined,
          tool_choice: toolsForRequest.length > 0 ? 'auto' : undefined,
        }),
      );
      response = result.response;
      usedEntry = result.used;
      if (result.failoverFrom) {
        (globalThis as Record<string, unknown>).__lastFailover = {
          from: result.failoverFrom,
          to: usedEntry.label,
          reason: result.failoverReason,
        };
      }
    } catch (e) {
      console.error('Tool-loop failover exhausted:', e);
      throw e instanceof Error ? e : new Error(String(e));
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from AI');

    const msg = choice.message;
    openAIMessages.push(msg);

    // If the model wants to call tools
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const toolNames = msg.tool_calls.map((tc: { function: { name: string } }) => tc.function.name);
      toolsUsed.push(...toolNames);
      console.log(`AI requested ${msg.tool_calls.length} tool calls:`, toolNames);

      // Create task on first tool call
      if (!taskCreated && onTaskUpdate) {
        const title = inferTaskTitle(toolNames);
        await onTaskUpdate({ taskId, title, step: 'Starting...', status: 'in_progress' });
        taskCreated = true;
      }

      // Execute all tool calls in parallel with task updates
      const toolResults = await Promise.all(
        msg.tool_calls.map(async (tc: { id: string; function: { name: string; arguments: string } }) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          // Inject user ID for tools that need it
          if (['save_memory', 'search_wisdom_memories', 'update_memory', 'deep_research', 'scrape_events', 'list_events', 'upload_youtube_video', 'add_standing_order', 'remove_standing_order', 'update_standing_order', 'add_goal', 'update_goal_progress', 'complete_goal', 'generate_image', 'edit_image', 'generate_video', 'create_routine', 'list_routines', 'toggle_routine', 'delete_routine'].includes(tc.function.name) && userId) {
            args.__user_id = userId;
          }
          const stepLabel = TOOL_DISPLAY_NAMES[tc.function.name] || tc.function.name;
          if (onTaskUpdate) await onTaskUpdate({ taskId, title: '', step: stepLabel, status: 'in_progress' });

          console.log(`Executing tool: ${tc.function.name}`, args);

          // Auto-upgrade web_investigate → streaming variant for live progress.
          // Falls back to blocking dispatch on any error.
          let result: { success: boolean; result: string; structured?: Record<string, unknown> } | null = null;
          if (tc.function.name === 'web_investigate' && onTaskUpdate) {
            const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
            if (authHeader) {
              try {
                result = await streamWebInvestigate(args, authHeader, taskId, onTaskUpdate);
                if (result) console.log('[web_investigate] delivered_via=stream');
              } catch (e) {
                console.warn('[web_investigate] stream upgrade failed, falling back:', e);
                result = null;
              }
            }
          }
          if (!result) {
            // ============================================================
            // WRITE GUARDRAIL (Guardrail Fix #2)
            // Block GHL write tools when the active account came from the
            // user's permanent default but the conversation mentions a
            // different sub-account by name. Force the model to call
            // ghl_set_active_sub_account first.
            // ============================================================
            const GHL_WRITE_PREFIXES = ['ghl_create_', 'ghl_update_', 'ghl_delete_', 'ghl_archive_', 'ghl_send_', 'ghl_upsert_', 'ghl_book_', 'ghl_cancel_', 'ghl_add_', 'ghl_remove_', 'ghl_edit_', 'ghl_trigger_', 'ghl_import_', 'ghl_upload_'];
            const isGhlWrite = GHL_WRITE_PREFIXES.some((p) => tc.function.name.startsWith(p));
            if (isGhlWrite && ghlCreds?.subAccounts && ghlCreds.subAccounts.length > 1) {
              const memSrc = (globalThis as Record<string, unknown>).__ghlMemorySource as string | undefined;
              const mentionedName = (globalThis as Record<string, unknown>).__ghlMentionedSubName as string | undefined;
              const switchedThisTurn = !!(globalThis as Record<string, unknown>).__ghlSwitchedThisTurn;
              const activeSub = ghlCreds.subAccounts.find((s) => s.id === ghlCreds.locationId);
              if (memSrc === 'default' && !switchedThisTurn && mentionedName && activeSub && activeSub.name.toLowerCase() !== mentionedName.toLowerCase()) {
                const subList = ghlCreds.subAccounts.map((s) => `"${s.name}"`).join(', ');
                result = {
                  success: false,
                  result: JSON.stringify({
                    error: 'AMBIGUOUS_SUBACCOUNT',
                    message: `Refusing to write to "${activeSub.name}" — that's your permanent default, but the conversation mentions "${mentionedName}". Call ghl_set_active_sub_account with name="${mentionedName}" first, then retry this write.`,
                    resolved_account: activeSub.name,
                    resolved_location_id: activeSub.id,
                    mentioned_account: mentionedName,
                    available_accounts: subList,
                    fix: `ghl_set_active_sub_account(name="${mentionedName}")`,
                  }),
                };
                console.warn(`[GHL guardrail] BLOCKED ${tc.function.name}: default=${activeSub.name} mentioned=${mentionedName}`);
              }
            }
            if (tc.function.name === 'ghl_set_active_sub_account') {
              (globalThis as Record<string, unknown>).__ghlSwitchedThisTurn = true;
            }
            if (!result) {
              result = await executeToolCall(tc.function.name, args, connMap, userMessage, aliasMap, ghlCreds);
              // Echo target sub-account on successful GHL writes so the user sees it.
              if (isGhlWrite && result.success && ghlCreds?.subAccounts) {
                const sub = ghlCreds.subAccounts.find((s) => s.id === ghlCreds.locationId);
                if (sub && !result.result.includes(sub.name)) {
                  result = { ...result, result: `[Account: ${sub.name}] ${result.result}` };
                }
              }
            }
          }
          console.log(`Tool result (${tc.function.name}):`, result.success ? 'SUCCESS' : 'FAILED', result.result.substring(0, 200));

          // Capture structured investigation payload for artifact persistence.
          if (tc.function.name === 'web_investigate' && result.success && result.structured) {
            investigations.push({
              question: (args.query as string) || '',
              payload: result.structured,
            });
          }
          // Capture personal_research report for ResearchCard rendering.
          if (tc.function.name === 'personal_research' && result.success && result.structured) {
            const s = result.structured as Record<string, unknown>;
            const rid = typeof s.reportId === 'string' ? s.reportId : null;
            if (rid) {
              researchReports.push({
                reportId: rid,
                query: (typeof s.query === 'string' ? s.query : (args.query as string)) || '',
                confidence: typeof s.confidence === 'number' ? s.confidence : 0,
              });
            }
          }

          if (onTaskUpdate) await onTaskUpdate({ taskId, title: '', step: stepLabel, status: result.success ? 'done' : 'error' });

          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify(result),
          };
        })
      );

      // Add all tool results to messages
      openAIMessages.push(...toolResults);

      // GUARD: if user just approved an action and assistant only called task-tracking tools,
      // inject a system reminder to actually execute the action on next iteration.
      const APPROVAL_RE = /^\s*(yes|yep|yeah|ok|okay|sure|do it|go ahead|approved|confirm|confirmed|send it|trash (them|it)|delete (them|it)|proceed)\s*[.!]?\s*$/i;
      const onlyTaskTools = toolNames.length > 0 && toolNames.every((n: string) => n === 'create_work_task' || n === 'update_work_task' || n === 'bulk_update_work_tasks');
      // Find last user message (skip tool/assistant) BEFORE this assistant turn
      const lastUser = [...openAIMessages].reverse().find((m) => m.role === 'user');
      const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : '';
      if (onlyTaskTools && APPROVAL_RE.test(lastUserText)) {
        console.log('[ToolLoopGuard] Approval detected but only task-tracking tools called. Injecting reminder.');
        openAIMessages.push({
          role: 'system',
          content: 'REMINDER: The user just approved an action. You called only create_work_task/update_work_task — that is tracking, not execution. Call the actual action tool now (e.g. batch_trash_emails, send_email, delete_calendar_event). Do not respond with text until the real tool has been invoked.',
        });
      }
      // Continue the loop so the model can process tool results
      continue;
    }

    // No tool calls - return the final response
    if (taskCreated && onTaskUpdate) {
      // Extract a short summary from the AI's final response for the task bubble
      const summary = (msg.content || '').substring(0, 200);
      await onTaskUpdate({ taskId, title: '', step: 'Complete', status: 'done', summary });
    }
    return { role: 'assistant', content: msg.content || '', toolsUsed, investigations, researchReports };
  }

  return { role: 'assistant', content: 'I tried to complete the action but hit the maximum number of steps. Please try again with a simpler request.', toolsUsed, investigations, researchReports };
}

// ============================================================================
// INFINITY ROUTER — Intelligent Pre-processing Layer
// ============================================================================

// 8 high-level domains used to gate tools per turn (Tool Sectioning v2).
// 'system' is always loaded (memory, goals, web search, work tasks, creative gen).
export type ToolDomain =
  | 'google-workspace'
  | 'google-marketing'
  | 'crm'
  | 'projects'
  | 'finance'
  | 'memory'
  | 'creative'
  | 'system';

export const ALL_DOMAINS: ToolDomain[] = [
  'google-workspace', 'google-marketing', 'crm', 'projects', 'finance', 'memory', 'creative', 'system',
];

interface InfinityClassification {
  intent: string;
  input_length: number;
  needs_memory: boolean;
  needs_deep_reasoning: boolean;
  needs_multimodal: boolean;
  needs_live_data: boolean;
  confidence: number;
  domains: ToolDomain[];
}

type InfinityPath = 'gemini_flash' | 'gemini_pro' | 'retrieval' | 'action' | 'default_chat';

interface InfinityRouterResult {
  path: InfinityPath;
  scores: Record<InfinityPath, number>;
  classification: InfinityClassification;
  enrichment: string | null;
  timing_ms: number;
  fallback: boolean;
}

// Keyword → domain map. Cheap, deterministic, works without an extra LLM call.
// 'system' is always included separately (always-on tools).
const DOMAIN_KEYWORDS: Record<Exclude<ToolDomain, 'system'>, string[]> = {
  'google-workspace': [
    'gmail', 'email', 'inbox', 'mail', 'send', 'compose', 'draft', 'reply',
    'calendar', 'schedule', 'event', 'meeting', 'appointment', 'invite', 'rsvp', 'free slot', 'freebusy',
    'drive', 'folder', 'file', 'doc', 'document', 'sheet', 'spreadsheet', 'slide', 'presentation',
    'google doc', 'google sheet', 'google slide',
  ],
  'google-marketing': [
    'search console', 'gsc', 'seo', 'ranking', 'impressions', 'ctr', 'organic',
    'analytics', 'ga4', 'traffic', 'sessions', 'pageviews', 'bounce', 'conversion rate',
    'tag manager', 'gtm',
  ],
  'crm': [
    'ghl', 'gohighlevel', 'go high level', 'highlevel', 'crm', 'contact', 'lead', 'opportunity',
    'pipeline', 'campaign', 'workflow', 'invoice', 'subscription', 'product',
    'sub-account', 'sub account', 'location', 'snapshot', 'blog post', 'social post',
  ],
  'projects': [
    'clickup', 'task', 'subtask', 'list', 'space', 'checklist', 'time entry', 'timer',
    'priority', 'assignee', 'due date', 'tag', 'dependency', 'comment',
  ],
  'finance': [
    'plaid', 'bank', 'banking', 'transaction', 'balance', 'account', 'spend', 'spending',
    'budget', 'expense', 'income',
  ],
  'memory': [
    'remember', 'recall', 'last time', 'you said', 'we discussed', 'previously',
    'my preference', 'i told you', 'you know that', 'memory', 'standing order', 'rule',
    'goal', 'objective',
  ],
  'creative': [
    'image', 'photo', 'picture', 'generate image', 'edit image', 'video', 'render',
    'higgsfield', 'thumbnail', 'art', 'illustration', 'youtube upload', 'upload video',
  ],
};

function detectDomains(text: string): ToolDomain[] {
  const lower = text.toLowerCase();
  const found = new Set<ToolDomain>(['system']); // always-on
  for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    if (kws.some(k => lower.includes(k))) found.add(domain as ToolDomain);
  }
  return [...found];
}

function isContextDependentFollowup(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return false;

  const shortApprovalOrRetry = [
    'yes', 'yep', 'yeah', 'ok', 'okay', 'sure', 'do it', 'go ahead', 'approved', 'approve',
    'confirm', 'confirmed', 'proceed', 'retry', 'retry it', 'retry that', 'retry previous task',
    'try again', 'do it again',
  ];
  if (shortApprovalOrRetry.includes(lower)) return true;

  return [
    'it did it again',
    'same thing',
    'still not working',
    'still broken',
    'make it work',
    'wtf',
    'fuck',
    'fucking',
  ].some((signal) => lower.includes(signal));
}

function detectDomainsFromRecentUserHistory(messages: { role: string; content: string }[], maxUserTurns = 4): ToolDomain[] {
  const found = new Set<ToolDomain>(['system']);
  let skippedCurrentUser = false;
  let inspected = 0;

  for (let i = messages.length - 1; i >= 0 && inspected < maxUserTurns; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' || !msg.content) continue;
    if (!skippedCurrentUser) {
      skippedCurrentUser = true;
      continue;
    }
    inspected += 1;
    for (const domain of detectDomains(msg.content)) found.add(domain);
  }

  return [...found];
}

function classifyMessage(messages: { role: string; content: string }[]): InfinityClassification {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const text = lastUser?.content || '';
  const lower = text.toLowerCase();
  const len = text.length;

  const memoryKw = ['remember', 'recall', 'last time', 'you said', 'we discussed', 'previously', 'my preference', 'i told you', 'you know that'];
  const analysisKw = ['analyze', 'analysis', 'compare', 'synthesize', 'summarize a long', 'deep dive', 'explain in detail', 'break down', 'evaluate', 'assess', 'review this', 'what do you think about'];
  const multimodalKw = ['image', 'photo', 'screenshot', 'picture', 'file', 'pdf', 'document', 'attachment'];
  const actionKw = ['send', 'create', 'schedule', 'book', 'post', 'draft', 'compose', 'upload'];
  const liveDataKw = ['weather', 'stock', 'price', 'news', 'current', 'today\'s', 'latest'];
  const contextualFollowup = isContextDependentFollowup(text);
  const directDomains = detectDomains(text);
  const contextualDomains = contextualFollowup ? detectDomainsFromRecentUserHistory(messages) : [];
  const domains = [...new Set<ToolDomain>([...directDomains, ...contextualDomains])];
  const inheritedActionIntent = contextualFollowup && [...messages]
    .slice(0, -1)
    .reverse()
    .some((m) => m.role === 'user' && actionKw.some((k) => m.content.toLowerCase().includes(k)));

  return {
    intent: analysisKw.some(k => lower.includes(k)) ? 'analysis' : (actionKw.some(k => lower.includes(k)) || inheritedActionIntent) ? 'action' : 'general',
    input_length: len,
    needs_memory: memoryKw.some(k => lower.includes(k)),
    needs_deep_reasoning: analysisKw.some(k => lower.includes(k)) || len > 2000,
    needs_multimodal: multimodalKw.some(k => lower.includes(k)),
    needs_live_data: liveDataKw.some(k => lower.includes(k)),
    confidence: contextualFollowup ? 0.9 : len < 20 ? 0.9 : len > 5000 ? 0.5 : 0.7,
    domains,
  };
}

function scoreRoutes(c: InfinityClassification): Record<InfinityPath, number> {
  const scores: Record<InfinityPath, number> = {
    gemini_flash: 0,
    gemini_pro: 0,
    retrieval: 0,
    action: 0,
    default_chat: 2, // base weight — default always has a floor
  };

  // Long input → flash for summarization/extraction
  if (c.input_length > 8000) scores.gemini_flash += 3;
  if (c.input_length > 3000) scores.gemini_flash += 1;

  // Multimodal → pro
  if (c.needs_multimodal) scores.gemini_pro += 4;

  // Deep reasoning → pro
  if (c.needs_deep_reasoning) scores.gemini_pro += 3;

  // Memory → retrieval path (existing wisdom engine handles it)
  if (c.needs_memory) scores.retrieval += 4;

  // Action intent → action path (existing tool loop handles it)
  if (c.intent === 'action') scores.action += 5;

  // Simple short question → default
  if (c.input_length < 100 && c.confidence > 0.8) scores.default_chat += 5;

  // Low confidence → safe default
  if (c.confidence < 0.5) scores.default_chat += 3;

  return scores;
}

function pickRoute(scores: Record<InfinityPath, number>): InfinityPath {
  let best: InfinityPath = 'default_chat';
  let bestScore = -1;
  for (const [path, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; best = path as InfinityPath; }
  }
  return best;
}

async function geminiPreProcess(
  messages: { role: string; content: string }[],
  path: 'gemini_flash' | 'gemini_pro',
): Promise<string | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) { console.error('[InfinityRouter] LOVABLE_API_KEY not set'); return null; }

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return null;

  const model = path === 'gemini_pro' ? 'google/gemini-2.5-pro' : 'google/gemini-2.5-flash';
  const taskPrompt = path === 'gemini_pro'
    ? 'You are a pre-processor. Analyze the user\'s input and produce a structured summary covering: key topics, implicit questions, suggested approach, and any nuances. Be concise (under 300 words).'
    : 'You are a pre-processor. Extract the key facts, questions, and context from this input. Produce a concise structured brief (under 200 words).';

  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: taskPrompt },
          { role: 'user', content: lastUser.content },
        ],
        max_completion_tokens: 500,
      }),
    });

    if (!res.ok) {
      console.error(`[InfinityRouter] Gemini ${path} failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return `\n\n===========================================================
INFINITY ROUTER — PRE-PROCESSED CONTEXT (${path})
===========================================================
${content}`;
  } catch (e) {
    console.error(`[InfinityRouter] Gemini call error:`, e);
    return null;
  }
}

async function runInfinityRouter(
  messages: { role: string; content: string }[],
  debugMode: boolean,
): Promise<{ enrichment: string | null; debug: InfinityRouterResult | null; classification: InfinityClassification | null; fallback: boolean }> {
  const start = Date.now();
  let fallback = false;

  try {
    const classification = classifyMessage(messages);
    const scores = scoreRoutes(classification);
    const path = pickRoute(scores);

    console.log(`[InfinityRouter] Path: ${path}, Scores:`, scores, 'Domains:', classification.domains);

    let enrichment: string | null = null;

    // Only call Gemini for gemini_flash/gemini_pro paths
    if (path === 'gemini_flash' || path === 'gemini_pro') {
      enrichment = await geminiPreProcess(messages, path);
      if (!enrichment) fallback = true; // Gemini failed, will use default flow
    }
    // retrieval and action paths: no enrichment needed, existing systems handle them

    const timing_ms = Date.now() - start;
    const result: InfinityRouterResult = { path, scores, classification, enrichment, timing_ms, fallback };

    return {
      enrichment,
      debug: debugMode ? result : null,
      classification,
      fallback,
    };
  } catch (e) {
    console.error('[InfinityRouter] Error, falling back:', e);
    return { enrichment: null, debug: debugMode ? { path: 'default_chat', scores: { gemini_flash: 0, gemini_pro: 0, retrieval: 0, action: 0, default_chat: 10 }, classification: { intent: 'error', input_length: 0, needs_memory: false, needs_deep_reasoning: false, needs_multimodal: false, needs_live_data: false, confidence: 0, domains: ALL_DOMAINS }, enrichment: null, timing_ms: Date.now() - start, fallback: true } : null, classification: null, fallback: true };
  }
}

// ============================================================================
// POST-TURN MEMORY EXTRACTION — Background learning from conversations
// ============================================================================

async function extractPostTurnMemories(
  messages: { role: string; content: string }[],
  assistantResponse: string,
  userId: string,
): Promise<void> {
  const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!OPENAI_KEY || !serviceRoleKey || !supabaseUrl) return;

  // Only extract from the last few messages to keep it lightweight
  const recentMessages = messages.slice(-4);
  const lastUserMsg = [...recentMessages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg || lastUserMsg.content.length < 20) return;

  // Skip if the conversation is purely transactional (email listing, etc.)
  const transactionalKeywords = ['list my', 'show me', 'what are my', 'how many'];
  if (transactionalKeywords.some(k => lastUserMsg.content.toLowerCase().startsWith(k))) return;

  try {
    const extractionPrompt = `Analyze this conversation excerpt and extract any durable, reusable learnings about the user. Focus on:
- Stated preferences ("I always want...", "Don't ever...", "I prefer...")
- Corrections the user made to the AI
- Workflow patterns the user established
- Personal facts (business name, role, goals)
- Values or principles they expressed

Return a JSON array of memories to save. Each: { memory_type: "fact"|"preference"|"pattern"|"context"|"goal"|"value", content: string (1-2 sentences), summary: string (one line), salience: 0.3-0.9 }
Return an EMPTY array [] if nothing qualifies as a durable memory.
Return ONLY the JSON array, no commentary.`;

    const conversationText = recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: extractionPrompt },
          { role: 'user', content: conversationText },
        ],
        max_completion_tokens: 1024,
      }),
    });

    if (!res.ok) {
      console.error('[PostTurnMemory] AI call failed:', res.status, await res.text().catch(() => ''));
      return;
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '[]';

    let memories: Array<{ memory_type: string; content: string; summary: string; salience: number }>;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      memories = JSON.parse(cleaned);
    } catch { return; }

    if (!Array.isArray(memories) || memories.length === 0) return;

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    for (const mem of memories.slice(0, 3)) { // Max 3 per turn
      try {
        // Generate embedding
        const embRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: mem.content }),
        });
        if (!embRes.ok) continue;
        const embData = await embRes.json();
        const embedding = embData.data[0].embedding;

        // Dedup check
        const { data: similar } = await adminClient.rpc('match_wisdom_memories', {
          query_embedding: JSON.stringify(embedding),
          match_threshold: 0.9,
          match_count: 1,
          filter_user_id: userId,
          filter_memory_type: null,
        });

        if (similar && similar.length > 0) {
          // Reinforce existing
          const existing = similar[0];
          await adminClient.from('wisdom_memories').update({
            recurrence_count: (existing.recurrence_count || 1) + 1,
            confidence: Math.min((existing.confidence || 0.8) + 0.03, 1.0),
            salience: Math.max(existing.salience || 0.5, mem.salience || 0.5),
            updated_at: new Date().toISOString(),
          }).eq('id', existing.id);
          console.log(`[PostTurnMemory] Reinforced: "${existing.summary || existing.content.substring(0, 50)}"`);
        } else {
          // Insert new
          await adminClient.from('wisdom_memories').insert({
            user_id: userId,
            memory_type: mem.memory_type || 'fact',
            content: mem.content,
            summary: mem.summary,
            embedding: JSON.stringify(embedding),
            salience: mem.salience || 0.5,
            confidence: 0.7, // Lower confidence for auto-extracted
          });
          console.log(`[PostTurnMemory] Saved: "${mem.summary}"`);
        }
      } catch (e) {
        console.error('[PostTurnMemory] Memory save error:', e);
      }
    }
  } catch (e) {
    console.error('[PostTurnMemory] Extraction error:', e);
  }
}

// ============================================================================
// MAIN REQUEST HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Tool-registry health probe — used by Developer page + log inspection.
  // GET /chat?health=registry returns live/quarantined tool counts.
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('health') === 'registry') {
    // Force lazy init of legacy validated tools (so getRegistryHealth is meaningful).
    try { getValidatedTools(); } catch { /* ignore */ }
    return new Response(JSON.stringify({ ok: true, registry: getRegistryHealth() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const requestStart = Date.now();
    const body = await req.json();
    // Support both { messages: [...] } and { message: "..." } formats
    let messages = body.messages;
    if (!Array.isArray(messages)) {
      if (typeof body.message === 'string') {
        messages = [{ role: 'user', content: body.message }];
      } else {
        return new Response(JSON.stringify({ error: 'messages array is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    const {
      intent,
      systemName = 'Ozlon',
      model = DEFAULT_MODEL,
      agentId: _agentId,
      agentMetadata: _agentMetadata,
      enableTools = false,
      userSettings,
      routing_mode,
    } = body;

    // Store auth context for tool handlers (create_work_task needs user ID)
    (globalThis as Record<string, unknown>).__currentAuthHeader = req.headers.get('Authorization') || undefined;
    (globalThis as Record<string, unknown>).__currentSessionId = body.sessionId || undefined;
    // Routing budget (Brain page Speed/Balanced/Quality toggle) — picked up by callWithFallback → gauntletCall.
    (globalThis as Record<string, unknown>).__currentRoutingMode =
      routing_mode === 'speed' || routing_mode === 'balanced' || routing_mode === 'quality'
        ? routing_mode
        : undefined;

    const modelConfig = MODEL_REGISTRY[model] || MODEL_REGISTRY[DEFAULT_MODEL];
    const apiKey = Deno.env.get(modelConfig.apiKeyEnvVar);
    if (!apiKey) throw new Error(`${modelConfig.apiKeyEnvVar} is not configured`);

    // Build system prompt
    let systemPrompt = buildSystemPrompt(systemName, userSettings);

    // Infinity Router — additive pre-processing + tool-domain gating (v2)
    let infinityDebug: InfinityRouterResult | null = null;
    let routerClassification: InfinityClassification | null = null;
    let routerFallback = false;
    // We always run the router (cheap — pure keyword classification by default)
    // because v2 needs `classification.domains` to gate tool exposure.
    // The opt-in env var still gates the Gemini enrichment hop inside the router.
    try {
      const debugMode = Deno.env.get('INFINITY_ROUTER_DEBUG') === 'true';
      const routerResult = await runInfinityRouter(messages, debugMode);
      if (routerResult.enrichment) systemPrompt += routerResult.enrichment;
      infinityDebug = routerResult.debug;
      routerClassification = routerResult.classification;
      routerFallback = routerResult.fallback;
      console.log('[InfinityRouter] Complete', infinityDebug?.path, infinityDebug?.timing_ms + 'ms');
    } catch (e) {
      console.error('[InfinityRouter] Fallback to default:', e);
      routerFallback = true;
    }

    // Compute allowed tool domains for v2 gating.
    // Safety net: if classification missing OR confidence < 0.5 OR fallback fired,
    // pass `undefined` → no gating, identical to v1 (zero regression risk).
    const allowedDomains: string[] | undefined =
      (routerClassification && !routerFallback && routerClassification.confidence >= 0.5)
        ? routerClassification.domains
        : undefined;
    if (allowedDomains) {
      console.log('[ToolSectioning] Gating tools to domains:', allowedDomains);
    } else {
      console.log('[ToolSectioning] No gating (router fallback or low confidence) — loading all tools');
    }

    // Native connection discovery + per-user GHL credential resolution
    let GHL_API_KEY_RESOLVED: string | undefined;
    let GHL_LOCATION_ID_RESOLVED: string | undefined;
    let GHL_SUB_ACCOUNTS_RESOLVED: { id: string; name: string; api_key?: string; scopes?: string[] }[] | undefined;
    let GHL_ACTIVE_SCOPES: string[] | undefined; // scopes of the active sub-account, used to gate tools

    // Resolve user ID early for credential lookup + native discovery
    const authHeaderForCreds = req.headers.get('Authorization');
    let credUserId: string | null = null;
    console.log(`[Auth] header present: ${!!authHeaderForCreds}, starts with Bearer: ${authHeaderForCreds?.startsWith('Bearer ') ?? false}`);
    if (authHeaderForCreds) {
      try {
        const { createClient: cc } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const anonK = Deno.env.get('SUPABASE_ANON_KEY')!;
        const uc = cc(Deno.env.get('SUPABASE_URL')!, anonK, { global: { headers: { Authorization: authHeaderForCreds } } });
        const { data: { user: credUser }, error: authErr } = await uc.auth.getUser();
        credUserId = credUser?.id || null;
        console.log(`[Auth] resolved credUserId: ${credUserId ? credUserId.slice(0, 8) + '...' : 'null'}, error: ${authErr?.message || 'none'}`);
      } catch (e) {
        console.error('[Auth] getUser threw:', (e as Error).message);
      }
    }

    // Expose userId to tool handlers (used by load_skill, etc.)
    (globalThis as Record<string, unknown>).__currentUserId = credUserId || undefined;

    // ================================================================
    // SKILLS PLATFORM — inject compact index of installed skills.
    // Full instructions are loaded on-demand via the load_skill tool.
    // ================================================================
    if (credUserId) {
      try {
        const installed = await getInstalledSkills(credUserId);
        // Mode-aware gating: filter by user's current cognitive mode if known.
        let currentMode: string | null = null;
        try {
          const { createClient: ccM } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
          const adminM = ccM(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          const { data: ctx } = await adminM
            .from('user_context_state')
            .select('current_mode')
            .eq('user_id', credUserId)
            .maybeSingle();
          currentMode = (ctx?.current_mode as string | undefined) ?? null;
        } catch (_) { /* mode optional */ }
        (globalThis as Record<string, unknown>).__currentMode = currentMode ?? undefined;
        const gated = filterSkillsByMode(installed, currentMode);
        const indexBlock = formatSkillIndexForPrompt(buildSkillIndex(gated), currentMode);
        if (indexBlock) {
          systemPrompt += `\n\n${indexBlock}`;
          console.log(`[Skills] Injected ${gated.length}/${installed.length} skill(s) (mode=${currentMode ?? 'any'}).`);
        }
      } catch (e) {
        console.error('[Skills] Failed to load installed skills:', (e as Error).message);
      }
    }

    // ================================================================
    // PERSONALITY & IDENTITY LAYER — user-authored persona override
    // Loaded BEFORE other prompt enrichment so user identity sits at top.
    // ================================================================
    if (credUserId) {
      try {
        const { createClient: ccP } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const srvKeyP = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const adminP = ccP(Deno.env.get('SUPABASE_URL')!, srvKeyP);
        const { data: persona } = await adminP
          .from('user_personality')
          .select('identity, about_me, house_rules, tone_settings, reference_persona')
          .eq('user_id', credUserId)
          .maybeSingle();
        if (persona) {
          const parts: string[] = [];
          const identity = (persona.identity || {}) as Record<string, unknown>;
          if (identity.statement && typeof identity.statement === 'string') {
            parts.push(`CORE IDENTITY:\n${identity.statement}`);
          }
          if (persona.reference_persona && typeof persona.reference_persona === 'string') {
            parts.push(`REFERENCE PERSONA (channel this voice):\n${persona.reference_persona}`);
          }
          if (persona.about_me && typeof persona.about_me === 'string') {
            parts.push(`ABOUT THE USER YOU SERVE:\n${persona.about_me}`);
          }
          const rules = Array.isArray(persona.house_rules) ? (persona.house_rules as string[]).filter(Boolean) : [];
          if (rules.length) {
            parts.push(`HOUSE RULES (these override defaults — never violate):\n${rules.map(r => `- ${r}`).join('\n')}\n\nRULE-UPDATE PROTOCOL: When the user phrases a change as "now do X, not Y", "instead of … do …", "change the rule about …", or "actually, from now on …", call update_standing_order or update_memory (NOT add_standing_order or save_memory) so the old rule is superseded instead of stacking. Always confirm in your reply: "Updated: previously '…', now '…'."`);
          }
          const tone = (persona.tone_settings || {}) as Record<string, unknown>;
          const toneLines = Object.entries(tone)
            .filter(([, v]) => typeof v === 'number')
            .map(([k, v]) => `- ${k}: ${v}/100`);
          if (toneLines.length) {
            parts.push(`TONE CALIBRATION (0=left trait, 100=right trait):\n${toneLines.join('\n')}`);
          }
          if (parts.length) {
            const personaBlock = `===========================================================
USER-AUTHORED PERSONALITY (HIGHEST PRIORITY — overrides defaults)
===========================================================
${parts.join('\n\n')}
===========================================================
`;
            systemPrompt = personaBlock + '\n' + systemPrompt;
          }
        }
      } catch (e) {
        console.error('[Personality] load failed:', e);
      }
    }

    if (credUserId) {
      try {
        const { createClient: cc2 } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const admin = cc2(Deno.env.get('SUPABASE_URL')!, srvKey);
        const { data: conns } = await admin
          .from('integration_connections')
          .select('provider, metadata')
          .eq('user_id', credUserId)
          .eq('status', 'connected')
          .eq('provider', 'gohighlevel');
        if (conns) {
          for (const c of conns) {
            const meta = (c.metadata as Record<string, unknown>) || {};
            const subAccounts = Array.isArray(meta.sub_accounts)
              ? (meta.sub_accounts as { id: string; name: string; api_key?: string; scopes?: string[] }[])
                  .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
              : [];

            // Prefer top-level api_key, otherwise fall back to the first sub-account
            // that carries its own key (common when only a location-level PIT is stored).
            let resolvedKey = (typeof meta.api_key === 'string' && meta.api_key) ? meta.api_key : '';
            let resolvedLocation = (typeof meta.location_id === 'string' && meta.location_id) ? meta.location_id : '';
            if (!resolvedKey) {
              const sub = subAccounts.find((s) => typeof s.api_key === 'string' && s.api_key);
              if (sub) {
                resolvedKey = sub.api_key as string;
                if (!resolvedLocation) resolvedLocation = sub.id;
              }
            }

            if (resolvedKey) {
              GHL_API_KEY_RESOLVED = resolvedKey;
              GHL_LOCATION_ID_RESOLVED = resolvedLocation || undefined;
              GHL_SUB_ACCOUNTS_RESOLVED = subAccounts;
            }
          }
        }

        // ============================================================
        // GHL ACTIVE-LOCATION MEMORY (3 layers, priority order):
        //   1. Session-level: chat_sessions.active_ghl_location_id
        //   2. User default:  profiles.default_ghl_location_id
        //   3. Metadata fallback (already resolved above)
        // ============================================================
        if (GHL_API_KEY_RESOLVED && GHL_SUB_ACCOUNTS_RESOLVED && GHL_SUB_ACCOUNTS_RESOLVED.length > 0) {
          let memoryLocationId: string | null = null;
          let memorySource: 'session' | 'default' | 'metadata' = 'metadata';

          const sid = (body.sessionId as string | undefined) || undefined;
          if (sid) {
            const { data: sess } = await admin
              .from('chat_sessions')
              .select('active_ghl_location_id')
              .eq('id', sid)
              .eq('user_id', credUserId)
              .maybeSingle();
            if (sess?.active_ghl_location_id) {
              memoryLocationId = sess.active_ghl_location_id;
              memorySource = 'session';
            }
          }

          if (!memoryLocationId) {
            const { data: prof } = await admin
              .from('profiles')
              .select('default_ghl_location_id')
              .eq('user_id', credUserId)
              .maybeSingle();
            if (prof?.default_ghl_location_id) {
              memoryLocationId = prof.default_ghl_location_id;
              memorySource = 'default';
            }
          }

          if (memoryLocationId) {
            const match = GHL_SUB_ACCOUNTS_RESOLVED.find((s) => s.id === memoryLocationId);
            if (match) {
              GHL_LOCATION_ID_RESOLVED = match.id;
              if (match.api_key) GHL_API_KEY_RESOLVED = match.api_key;
              if (Array.isArray(match.scopes) && match.scopes.length > 0) {
                GHL_ACTIVE_SCOPES = match.scopes.slice();
              }
              (globalThis as Record<string, unknown>).__ghlMemorySource = memorySource;
              console.log(`[GHL] Active sub-account from ${memorySource}: "${match.name}" (${match.id})`);
            }
          }
        }

        // If no session/default match yet, fall back to scopes of whichever
        // sub-account corresponds to GHL_LOCATION_ID_RESOLVED (the metadata default).
        if (!GHL_ACTIVE_SCOPES && GHL_LOCATION_ID_RESOLVED && GHL_SUB_ACCOUNTS_RESOLVED) {
          const match = GHL_SUB_ACCOUNTS_RESOLVED.find((s) => s.id === GHL_LOCATION_ID_RESOLVED);
          if (match && Array.isArray(match.scopes) && match.scopes.length > 0) {
            GHL_ACTIVE_SCOPES = match.scopes.slice();
          }
        }

        // ============================================================
        // CONTEXT-BOUND ACCOUNT BINDING (Guardrail Fix #1)
        // Scan the last user/assistant messages for sub-account names. If a
        // name is mentioned, override the resolved location even when the
        // model didn't explicitly call ghl_set_active_sub_account. This
        // prevents writes from silently going to the user's default
        // sub-account when conversation context names a different one.
        // ============================================================
        if (GHL_SUB_ACCOUNTS_RESOLVED && GHL_SUB_ACCOUNTS_RESOLVED.length > 1) {
          try {
            const recent = (Array.isArray(messages) ? messages : [])
              .slice(-10)
              .filter((m: { role?: string; content?: unknown }) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
              .map((m: { content: string }) => m.content.toLowerCase())
              .join(' \n ');
            // Score each sub-account by name-mention recency (last match wins).
            let mentioned: { id: string; name: string; api_key?: string; scopes?: string[] } | null = null;
            let bestPos = -1;
            for (const sub of GHL_SUB_ACCOUNTS_RESOLVED) {
              const needle = (sub.name || '').toLowerCase().trim();
              if (!needle || needle.length < 3) continue;
              const pos = recent.lastIndexOf(needle);
              if (pos > bestPos) { bestPos = pos; mentioned = sub; }
            }
            if (mentioned && mentioned.id !== GHL_LOCATION_ID_RESOLVED) {
              console.log(`[GHL] Context-bound override: switching from ${GHL_LOCATION_ID_RESOLVED} → "${mentioned.name}" (${mentioned.id}) — name mentioned in recent history`);
              GHL_LOCATION_ID_RESOLVED = mentioned.id;
              if (mentioned.api_key) GHL_API_KEY_RESOLVED = mentioned.api_key;
              if (Array.isArray(mentioned.scopes) && mentioned.scopes.length > 0) {
                GHL_ACTIVE_SCOPES = mentioned.scopes.slice();
              }
              (globalThis as Record<string, unknown>).__ghlMemorySource = 'context';
              (globalThis as Record<string, unknown>).__ghlMentionedSubName = mentioned.name;
              // Persist to chat_sessions so follow-ups stay locked to this account.
              const sid2 = (body.sessionId as string | undefined) || undefined;
              if (sid2) {
                try {
                  await admin.from('chat_sessions')
                    .update({ active_ghl_location_id: mentioned.id })
                    .eq('id', sid2)
                    .eq('user_id', credUserId);
                } catch (_e) { /* non-fatal */ }
              }
            } else if (mentioned) {
              // Same account already active — still record for guardrail logic.
              (globalThis as Record<string, unknown>).__ghlMentionedSubName = mentioned.name;
            }
          } catch (e) { console.warn('[GHL] context-binding scan failed:', e); }
        }
      } catch (e) { console.error('GHL credential lookup failed:', e); }
    }

    // No env fallback for GHL — credentials must be per-user from integration_connections.
    // (env GHL_API_KEY / GHL_LOCATION_ID are reserved for non-user contexts only.)

    // ── Signal Envelope (5-bucket priority context) ───────────────────────
    // Pure, cacheable. Renders only the top-priority slice into the system prompt.
    // Generalizes the GHL account-resolution guardrail across all integrations.
    try {
      if (credUserId) {
        const entities: Entity[] = [];
        for (const sub of (GHL_SUB_ACCOUNTS_RESOLVED || [])) {
          if (sub?.name && sub?.id) {
            entities.push({ kind: "ghl", id: sub.id, name: sub.name, payload: { api_key: sub.api_key } });
          }
        }
        const sig = `${entities.length}:${GHL_LOCATION_ID_RESOLVED ?? ""}`;
        const defaults: Record<string, { id: string; name: string; kind: string }> = {};
        const active: Record<string, { id: string; name: string; kind: string }> = {};
        const activeGhl = (GHL_SUB_ACCOUNTS_RESOLVED || []).find((s) => s.id === GHL_LOCATION_ID_RESOLVED);
        if (activeGhl) {
          const memSrc = (globalThis as Record<string, unknown>).__ghlMemorySource as string | undefined;
          const slot = memSrc === "session" || memSrc === "context" ? active : defaults;
          slot.ghl = { id: activeGhl.id, name: activeGhl.name, kind: "ghl" };
        }
        const envelope = buildSignalEnvelope({
          userId: credUserId,
          messages,
          entities,
          entitiesSignature: sig,
          defaults,
          active,
        });
        const block = renderForChatPrompt(envelope, { topN: 3 });
        systemPrompt += `\n\n${block}\n`;

        // Cross-check: if a GHL account is mentioned this turn that differs from
        // the active one, surface it for the guardrail (already handled below,
        // but envelope makes this generic for future integrations).
        const top = pickAccountByPriority(envelope, "ghl");
        if (top && top.id !== GHL_LOCATION_ID_RESOLVED) {
          console.log(`[SignalEnvelope] GHL account by priority differs: ${top.name} (${top.priority}) vs active ${GHL_LOCATION_ID_RESOLVED}`);
        }
      }
    } catch (e) {
      console.warn("[SignalEnvelope] build failed (non-fatal):", e);
    }

    const connMap: MultiConnMap = new Map();
    let availableTools: ToolDef[] = [];
    const aliasMap: AliasEntry[] = [];

    if (credUserId) {
      try {
        // Discover native connections (Google OAuth, ClickUp, YouTube, etc.)
        const nativeConns = await getNativeConnections(credUserId);
        const builtMap = buildMultiConnMap(nativeConns);
        for (const [app, entries] of builtMap) connMap.set(app, entries);
        console.log(`Native connections loaded: ${connMap.size} apps`, Array.from(connMap.keys()));

        // Determine available tools based on active connections
        availableTools = getAvailableTools(connMap, !!GHL_API_KEY_RESOLVED, allowedDomains);
        availableTools = applyGhlScopeFilter(availableTools, GHL_ACTIVE_SCOPES);
        console.log(`Available action tools: ${availableTools.length}` + (GHL_ACTIVE_SCOPES ? ` (ghl scopes: ${GHL_ACTIVE_SCOPES.length})` : ''));

        // Add connected services info to system prompt
        if (connMap.size > 0) {
          const connectedServices = Array.from(connMap.entries()).map(([app, entries]) => {
            const label = SERVICE_DETECTORS.find(s => s.app === app)?.label || app;
            const email = entries[0]?.email;
            return `- ${label}${email ? ` (${email})` : ''}`;
          }).join('\n');
          systemPrompt += `\n\n===========================================================
CONNECTED SERVICES (you can read data and take actions on these)
===========================================================\n${connectedServices}`;
        }

        // Inject read data for detected intents via native edges
        const nativeInjection = await injectNativeData(
          messages,
          connMap,
          credUserId,
          // (4th positional arg removed — injectNativeData(messages, connMap, userId))
        );
        if (nativeInjection) systemPrompt += nativeInjection;
      } catch (e) {
        console.error('Error in native setup:', e);
      }
    }

    // GoHighLevel data injection (uses its own API key)
    if (GHL_API_KEY_RESOLVED) {
      // Check if user is asking about GHL
      // Check if user is asking about GHL
      const ghlDetected = detectServiceIntents(messages).includes('gohighlevel');
      if (ghlDetected) {
        try {
          console.log('Fetching GoHighLevel data...');
          const ghlData = await fetchGHLData(GHL_API_KEY_RESOLVED, GHL_LOCATION_ID_RESOLVED);
          systemPrompt += `\n\n===========================================================
GOHIGHLEVEL CRM DATA
===========================================================
The following is REAL data from the user's GoHighLevel account. Use this to answer questions about their CRM, pipelines, contacts, etc.\n\n${ghlData}`;
          console.log('GHL data injected');
        } catch (e) {
          console.error('Error fetching GHL data:', e);
        }
      }

      // Add GHL to connected services list — name the active sub-account explicitly
      // so the model never claims GHL is "not connected" when the user references an
      // account by friendly name. Also tell the model WHERE the active account came from
      // (session memory, user default, or fallback) so it can confirm to the user.
      const activeSub = (GHL_SUB_ACCOUNTS_RESOLVED || []).find(s => s.id === GHL_LOCATION_ID_RESOLVED)
        || (GHL_SUB_ACCOUNTS_RESOLVED || [])[0];
      const subList = (GHL_SUB_ACCOUNTS_RESOLVED || []).map(s => `"${s.name}" (id: ${s.id})`).join(', ');
      const memSrc = (globalThis as Record<string, unknown>).__ghlMemorySource as string | undefined;
      const memLabel = memSrc === 'session' ? ' [active for this session]'
        : memSrc === 'default' ? ' [user default]'
        : '';
      systemPrompt += `\n\n===========================================================
GOHIGHLEVEL — CONNECTED AND READY
===========================================================
GoHighLevel IS connected. Do NOT tell the user it isn't connected. Do NOT ask them to connect it.
Active sub-account: ${activeSub ? `"${activeSub.name}" (location_id: ${activeSub.id})${memLabel}` : `location_id: ${GHL_LOCATION_ID_RESOLVED || 'unknown'}`}
${subList ? `All available sub-accounts: ${subList}` : ''}

ACCOUNT MEMORY:
- ghl_set_active_sub_account: switches the active account for the rest of THIS conversation only.
- ghl_set_default_sub_account: makes that account the user's PERMANENT default for all future conversations.
If the user says "make this my default" or "remember this account", use ghl_set_default_sub_account.
If the user just says "switch to X", use ghl_set_active_sub_account.
- ghl_list_sub_accounts: when the user asks "which GHL accounts do I have", "what's connected", or "what can X do", call this FIRST and answer from its output (it returns scope counts, capabilities, and disconnected state per account). Never invent accounts.
- ghl_check_capability: BEFORE any GHL write (create_*, update_*, delete_*, send_*), if you're unsure the active account has the right scope, call this with tool_name. If allowed=false, tell the user exactly which scope is missing and where to add it — do not attempt the call.

If the user names a sub-account that matches one above, call ghl_set_active_sub_account with that name BEFORE the requested action, then proceed.
If the user names a sub-account NOT in the list above, ask them to add it in Settings → Integrations → Go High Level.
GUARDRAIL: If a write tool returns error="AMBIGUOUS_SUBACCOUNT", do NOT retry blindly. Call ghl_set_active_sub_account with name=<mentioned_account> from the error, then retry the original write exactly once. Do NOT ask the user — the answer is in the error.
For all GHL actions (create custom field, list contacts, create opportunity, etc.), use the ghl_* tools directly. Do NOT emit a capability-gap or "service_not_connected" report for GHL.`;

      // Ensure GHL tools are available
      if (!availableTools.some(t => t.function.name.startsWith('ghl_'))) {
        availableTools = getAvailableTools(connMap, !!GHL_API_KEY_RESOLVED, allowedDomains);
        availableTools = applyGhlScopeFilter(availableTools, GHL_ACTIVE_SCOPES);
      }
    }

    // ================================================================
    // WISDOM ENGINE — Multi-source context injection + orchestration signal
    // Searches: knowledge entries, wisdom memories, reflection notes
    // Filters by knowledge_sources.is_active (plug-state).
    // Produces a structured wisdom_signal used by tool prioritization
    // and emitted as orchestration_trace at the end of the turn.
    // ================================================================
    const OPENAI_KEY_FOR_EMBED = Deno.env.get('OPENAI_API_KEY');
    let wisdomUserId: string | null = null;
    type WisdomSignal = {
      resonant_sources: Array<{ id: string; person: string; title: string; similarity: number }>;
      dominant_domains: string[];
      framework_hits: string[];
      memory_hits: number;
      reflection_hits: number;
      confidence: number;
    };
    let wisdomSignal: WisdomSignal = {
      resonant_sources: [],
      dominant_domains: [],
      framework_hits: [],
      memory_hits: 0,
      reflection_hits: 0,
      confidence: 0,
    };
    let frameworksInjected: Array<{ id: string; title: string }> = [];
    let memoriesInjected: Array<{ id: string; summary: string }> = [];
    let reflectionsInjected: Array<{ id: string; type: string }> = [];
    let knowledgeIdsForRecurrence: string[] = [];
    let memoryIdsForRecurrence: string[] = [];

    if (OPENAI_KEY_FOR_EMBED) {
      try {
        const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
        const queryText = lastUserMsg?.content || '';

        if (queryText.length > 10) {
          const embRes = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY_FOR_EMBED}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'text-embedding-3-small', input: queryText }),
          });

          if (embRes.ok) {
            const embData = await embRes.json();
            const queryEmbedding = embData.data[0].embedding;

            const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
            const supabaseUrl = Deno.env.get('SUPABASE_URL');
            if (serviceRoleKey && supabaseUrl) {
              const authHeader = req.headers.get('Authorization');
              if (authHeader) {
                try {
                  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
                  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
                  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
                  const { data: { user } } = await userClient.auth.getUser();
                  wisdomUserId = user?.id || null;
                } catch { /* no auth */ }
              }

              if (wisdomUserId) {
                const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
                const adminClient = createClient(supabaseUrl, serviceRoleKey);

                // Plug-state: which sources are active for this user?
                const { data: activeSources } = await adminClient
                  .from('knowledge_sources')
                  .select('id, person, title')
                  .eq('user_id', wisdomUserId)
                  .eq('is_active', true);
                const activeSourceIds = new Set((activeSources || []).map((s: { id: string }) => s.id));
                const sourceLookup = new Map<string, { person: string; title: string }>(
                  (activeSources || []).map((s: { id: string; person: string; title: string }) => [s.id, { person: s.person, title: s.title }])
                );

                // Run all three searches in parallel
                const [knowledgeRes, memoriesRes, reflectionsRes] = await Promise.all([
                  adminClient.rpc('match_knowledge', {
                    query_embedding: JSON.stringify(queryEmbedding),
                    match_threshold: 0.45,
                    match_count: 16, // overscan; we'll filter by plug-state
                    filter_user_id: wisdomUserId,
                    filter_domain: null,
                    filter_category: null,
                  }),
                  adminClient.rpc('match_wisdom_memories', {
                    query_embedding: JSON.stringify(queryEmbedding),
                    match_threshold: 0.4,
                    match_count: 6,
                    filter_user_id: wisdomUserId,
                    filter_memory_type: null,
                  }),
                  adminClient.rpc('match_reflections', {
                    query_embedding: JSON.stringify(queryEmbedding),
                    match_threshold: 0.4,
                    match_count: 4,
                    filter_user_id: wisdomUserId,
                    filter_note_type: null,
                  }),
                ]);

                // Hydrate knowledge with source_id (RPC doesn't return it)
                let activeKnowledge: Array<{ id: string; source_id: string | null; source_person: string; title: string; content: string; category: string; domain: string; similarity: number; recurrence_count?: number }> = [];
                const allHits = (knowledgeRes.data || []) as Array<{ id: string; source_person: string; title: string; content: string; category: string; domain: string; similarity: number }>;
                if (allHits.length > 0) {
                  const hitIds = allHits.map((k) => k.id);
                  const { data: hitRows } = await adminClient
                    .from('knowledge_entries')
                    .select('id, source_id')
                    .in('id', hitIds);
                  const meta = new Map<string, { source_id: string | null }>(
                    ((hitRows || []) as Array<{ id: string; source_id: string | null }>).map((r) => [r.id, { source_id: r.source_id }])
                  );
                  // Filter by plug-state (entries without a source_id are always allowed — legacy)
                  activeKnowledge = allHits
                    .map((k) => {
                      const m = meta.get(k.id);
                      return { ...k, source_id: m?.source_id ?? null };
                    })
                    .filter((k) => !k.source_id || activeSourceIds.has(k.source_id))
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, 8);
                }

                // ── Build wisdom_signal ──────────────────────────────────
                const domainCounts = new Map<string, number>();
                const frameworkSet = new Set<string>();
                for (const k of activeKnowledge) {
                  domainCounts.set(k.domain, (domainCounts.get(k.domain) || 0) + 1);
                  if (k.category === 'framework' || k.category === 'frameworks') {
                    frameworkSet.add(k.title);
                  }
                }
                const dominantDomains = [...domainCounts.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([d]) => d);
                const resonantSources: Array<{ id: string; person: string; title: string; similarity: number }> = [];
                const seenSourceIds = new Set<string>();
                for (const k of activeKnowledge) {
                  if (k.source_id && !seenSourceIds.has(k.source_id)) {
                    const s = sourceLookup.get(k.source_id);
                    if (s) {
                      resonantSources.push({ id: k.source_id, person: s.person, title: s.title, similarity: k.similarity });
                      seenSourceIds.add(k.source_id);
                    }
                  }
                }
                const memoryResults = (memoriesRes.data || []) as Array<{ id: string; memory_type: string; content: string; summary: string; confidence: number }>;
                const reflectionResults = (reflectionsRes.data || []) as Array<{ id: string; note_type: string; content: string; importance: number }>;
                const avgSim = activeKnowledge.length > 0
                  ? activeKnowledge.reduce((s, k) => s + k.similarity, 0) / activeKnowledge.length
                  : 0;
                wisdomSignal = {
                  resonant_sources: resonantSources.slice(0, 5),
                  dominant_domains: dominantDomains,
                  framework_hits: [...frameworkSet].slice(0, 5),
                  memory_hits: memoryResults.length,
                  reflection_hits: reflectionResults.length,
                  confidence: Number(avgSim.toFixed(2)),
                };

                knowledgeIdsForRecurrence = activeKnowledge.map((k) => k.id);
                memoryIdsForRecurrence = memoryResults.map((m) => m.id);

                // ── Inject STRUCTURED wisdom blocks ──────────────────────
                const frameworkEntries = activeKnowledge.filter((k) => k.category === 'framework' || k.category === 'frameworks');
                const principleEntries = activeKnowledge.filter((k) => !(k.category === 'framework' || k.category === 'frameworks'));

                if (frameworkEntries.length > 0) {
                  const block = frameworkEntries.map((k) =>
                    `- **${k.title}** — ${k.source_person} (${k.domain}, ${(k.similarity * 100).toFixed(0)}%) [src:${k.id}]\n  ${k.content}`
                  ).join('\n\n');
                  systemPrompt += `\n\n## Active Frameworks\nApply these by name when relevant. Cite them explicitly in your reasoning.\n\n${block}`;
                  frameworksInjected = frameworkEntries.map((k) => ({ id: k.id, title: k.title }));
                  console.log(`[Wisdom] ${frameworkEntries.length} frameworks injected`);
                }

                if (principleEntries.length > 0) {
                  const block = principleEntries.map((k) =>
                    `- **${k.title}** — ${k.source_person}/${k.category} (${(k.similarity * 100).toFixed(0)}%) [src:${k.id}]\n  ${k.content}`
                  ).join('\n\n');
                  systemPrompt += `\n\n## Relevant Principles\nDraw on these when shaping advice; attribute when material.\n\n${block}`;
                  console.log(`[Wisdom] ${principleEntries.length} principles injected`);
                }

                if (memoryResults.length > 0) {
                  const block = memoryResults.map((m) =>
                    `- [${m.memory_type}] ${m.summary || m.content} (${(m.confidence * 100).toFixed(0)}%) [mem:${m.id}]`
                  ).join('\n');
                  systemPrompt += `\n\n## Personal Memories\nGround truth about this user. **If a Personal Memory contradicts a Framework, the Memory wins.**\n\n${block}`;
                  memoriesInjected = memoryResults.map((m) => ({ id: m.id, summary: m.summary || m.content.slice(0, 80) }));
                  console.log(`[Wisdom] ${memoryResults.length} memories injected`);
                  adminClient.from('wisdom_memories').update({ last_accessed_at: new Date().toISOString() }).in('id', memoryIdsForRecurrence).then(() => {});
                }

                if (reflectionResults.length > 0) {
                  const block = reflectionResults.map((r) =>
                    `- [${r.note_type}] ${r.content} [ref:${r.id}]`
                  ).join('\n');
                  systemPrompt += `\n\n## Reflections\nPrior synthesized insights. Treat as prior conclusions, refine if new evidence contradicts.\n\n${block}`;
                  reflectionsInjected = reflectionResults.map((r) => ({ id: r.id, type: r.note_type }));
                  console.log(`[Wisdom] ${reflectionResults.length} reflections injected`);
                }

                if (wisdomSignal.framework_hits.length > 0 || wisdomSignal.dominant_domains.length > 0) {
                  console.log(`[Wisdom] Signal — domains=[${wisdomSignal.dominant_domains.join(',')}] frameworks=[${wisdomSignal.framework_hits.join(',')}] confidence=${wisdomSignal.confidence}`);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Wisdom Engine injection error:', e);
      }
    }

    // ================================================================
    // WISDOM-AWARE TOOL PRIORITIZATION
    // Reorder availableTools so domain-relevant tools appear first.
    // ================================================================
    let toolsReordered = false;
    if (availableTools.length > 0 && wisdomSignal.dominant_domains.length > 0) {
      const domainToToolPrefixes: Record<string, string[]> = {
        marketing: ['ghl_', 'higgsfield_', 'send_email', 'create_email_draft'],
        sales: ['ghl_', 'create_calendar_event', 'send_email'],
        ops: ['create_work_task', 'clickup_', 'calendar_', 'sheets_', 'docs_'],
        productivity: ['calendar_', 'sheets_', 'docs_', 'drive_', 'create_work_task'],
        creative: ['higgsfield_', 'descript_', 'upload_youtube_video', 'video_'],
        seo: ['gsc_', 'analytics_', 'web_search_google'],
        finance: ['plaid_'],
        memory: ['save_memory', 'search_wisdom_memories', 'add_standing_order', 'add_goal'],
      };
      const prefixSet = new Set<string>();
      for (const d of wisdomSignal.dominant_domains) {
        const prefixes = domainToToolPrefixes[d.toLowerCase()];
        if (prefixes) prefixes.forEach((p) => prefixSet.add(p));
      }
      if (prefixSet.size > 0) {
        const before = availableTools.map((t) => t.function.name);
        availableTools.sort((a, b) => {
          const aHit = [...prefixSet].some((p) => a.function.name.startsWith(p) || a.function.name === p) ? 0 : 1;
          const bHit = [...prefixSet].some((p) => b.function.name.startsWith(p) || b.function.name === p) ? 0 : 1;
          return aHit - bHit;
        });
        const after = availableTools.map((t) => t.function.name);
        toolsReordered = before.join(',') !== after.join(',');
        if (toolsReordered) {
          console.log(`[Wisdom] Tools reordered for domains [${wisdomSignal.dominant_domains.join(',')}]`);
        }
      }
    }

    // Build orchestration trace event payload (emitted later in stream)
    const orchestrationTrace = {
      intent: routerClassification?.intent || null,
      domains: routerClassification?.domains || [],
      agent_chosen: routerClassification?.intent || 'general',
      wisdom_signal: wisdomSignal,
      frameworks_injected: frameworksInjected,
      memories_injected: memoriesInjected,
      reflections_injected: reflectionsInjected,
      tools_reordered: toolsReordered,
      router_path: infinityDebug?.path || null,
    };

    // Helper: post-turn recurrence updates (gravitational compounding).
    const updateWisdomRecurrence = async (replyText: string) => {
      if (!wisdomUserId) return;
      try {
        const supabaseUrl2 = Deno.env.get('SUPABASE_URL')!;
        const serviceRoleKey2 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const adminClient = createClient(supabaseUrl2, serviceRoleKey2);

        const cited = new Set<string>();
        const memCited = new Set<string>();
        for (const m of replyText.matchAll(/\[src:([0-9a-f-]{8,})\]/gi)) cited.add(m[1]);
        for (const m of replyText.matchAll(/\[mem:([0-9a-f-]{8,})\]/gi)) memCited.add(m[1]);
        // Touch all injected entries as "considered" — softer pull
        const lower = replyText.toLowerCase();
        for (const k of knowledgeIdsForRecurrence) {
          // Only count knowledge entries whose framework name was actually mentioned
          const f = frameworksInjected.find((f) => f.id === k);
          if (f && lower.includes(f.title.toLowerCase())) cited.add(k);
        }

        const nowIso = new Date().toISOString();
        if (cited.size > 0) {
          const { data: rows } = await adminClient
            .from('knowledge_entries')
            .select('id, recurrence_count')
            .in('id', [...cited]);
          await Promise.all(((rows || []) as Array<{ id: string; recurrence_count: number | null }>).map((r) =>
            adminClient.from('knowledge_entries').update({
              recurrence_count: (r.recurrence_count || 0) + 1,
              last_accessed_at: nowIso,
            }).eq('id', r.id)
          ));
        }
        if (memCited.size > 0) {
          const { data: mrows } = await adminClient
            .from('wisdom_memories')
            .select('id, recurrence_count')
            .in('id', [...memCited]);
          await Promise.all(((mrows || []) as Array<{ id: string; recurrence_count: number | null }>).map((r) =>
            adminClient.from('wisdom_memories').update({
              recurrence_count: (r.recurrence_count || 0) + 1,
              last_accessed_at: nowIso,
            }).eq('id', r.id)
          ));
        }
      } catch (e) {
        console.error('[Wisdom] recurrence update error:', e);
      }
    };

    // ================================================================
    // SENTIENT WORKER — Identity Layer
    // Profile + active standing orders + active goals + last conversation summaries
    // Injected on EVERY call. Single biggest perception upgrade.
    // ================================================================
    if (credUserId) {
      try {
        const { createClient: ccId } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const adminId = ccId(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const sessionIdForId = (body.sessionId as string) || null;

        const [profileRes, ordersRes, goalsRes, summariesRes] = await Promise.all([
          adminId.from('profiles').select('first_name, full_name, system_name').eq('user_id', credUserId).maybeSingle(),
          adminId.from('standing_orders').select('id, rule, scope, priority').eq('user_id', credUserId).eq('active', true).order('priority', { ascending: true }).limit(20),
          adminId.from('user_goals').select('id, title, status, target_date, progress_notes').eq('user_id', credUserId).eq('status', 'active').order('updated_at', { ascending: false }).limit(8),
          adminId.from('chat_sessions').select('id, summary, updated_at').eq('user_id', credUserId).not('summary', 'is', null).neq('id', (body.sessionId as string) || '00000000-0000-0000-0000-000000000000').order('updated_at', { ascending: false }).limit(3),
        ]);

        const profile = profileRes.data as { first_name?: string; full_name?: string; system_name?: string } | null;
        const firstName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'friend';
        const osName = profile?.system_name || systemName || 'Ozlon';

        const now = new Date();
        const timeStr = now.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

        let identityBlock = `\n\n===========================================================
WHO YOU ARE & WHO YOU SERVE
===========================================================
You are ${osName}, ${firstName}'s personal worker. You exist to serve them with continuity, memory, and judgment.
Address them as ${firstName}. Be confident. Decide, then justify briefly.

# World state
- Local time: ${timeStr}
`;

        const orders = (ordersRes.data || []) as Array<{ id: string; rule: string; scope: string; priority: number }>;
        if (orders.length > 0) {
          identityBlock += `\n# Standing orders (always obey unless user says "ignore standing orders this turn")\n`;
          for (const o of orders) {
            identityBlock += `- [${o.scope}] ${o.rule}\n`;
          }
        }

        const goals = (goalsRes.data || []) as Array<{ id: string; title: string; target_date: string | null; progress_notes: unknown[] }>;
        if (goals.length > 0) {
          identityBlock += `\n# Active goals (reference when relevant)\n`;
          for (const g of goals) {
            const progress = Array.isArray(g.progress_notes) ? g.progress_notes.length : 0;
            identityBlock += `- ${g.title}${g.target_date ? ` (by ${g.target_date})` : ''} — ${progress} progress note(s)\n`;
          }
        }

        const summaries = (summariesRes.data || []) as Array<{ id: string; summary: string }>;
        if (summaries.length > 0) {
          identityBlock += `\n# Recent conversations (continuity)\n`;
          for (const s of summaries) {
            if (s.id !== sessionIdForId) {
              identityBlock += `- ${s.summary}\n`;
            }
          }
        }

        identityBlock += `\n# Uncertainty discipline
When you do not know something or your data is stale, prepend a hidden tag in this exact format on its own line:
[uncertain: <one-line reason>]
The UI will strip this from the user's view but it trains you to admit gaps instead of bluff. Never bluff.
`;

        systemPrompt += identityBlock;
        console.log(`[Identity] Injected: ${orders.length} orders, ${goals.length} goals, ${summaries.length} summaries`);
      } catch (e) {
        console.error('[Identity] Injection failed:', e);
      }
    }

    // Build OpenAI messages
    const openAIMessages: { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    console.log('Chat request:', {
      model: modelConfig.name,
      intent: intent || 'general',
      systemName,
      messagesCount: openAIMessages.length,
      toolsCount: availableTools.length,
      connectedServices: connMap.size,
    });

    // Detect if user is requesting an action (heuristic)
    const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
    const userText = (lastUserMsg?.content || '').toLowerCase();
    const actionKeywords = ['send', 'create', 'schedule', 'book', 'post', 'draft', 'compose', 'write to', 'message', 'notify', 'add contact', 'add deal', 'make a', 'set up', 'file a', 'open an issue', 'open a ticket', 'list contacts', 'list pipelines', 'list opportunities', 'list workflows', 'list campaigns', 'list calendars', 'add tag', 'remove tag', 'show my contacts', 'show my pipeline', 'show my deals', 'ghl', 'gohighlevel', 'high level', 'create a doc', 'create a sheet', 'create a spreadsheet', 'new spreadsheet', 'new doc', 'new document', 'create a presentation', 'new presentation', 'new slide', 'read sheet', 'append', 'add rows', 'create task', 'list tasks', 'clickup', 'invoice', 'invoices', 'orders', 'transactions', 'payments', 'forms', 'submissions', 'funnels', 'funnel', 'custom fields', 'custom values', 'team members', 'users', 'tags', 'delete contact', 'add note', 'add task', 'list notes', 'contact notes', 'contact tasks', 'cancel appointment', 'trigger workflow', 'run workflow', 'free slots', 'availability', 'conversations', 'message thread', 'search contacts', 'update contact', 'update opportunity', 'move deal', 'move stage', 'clean', 'clean up', 'clean out', 'filter', 'trash', 'delete email', 'remove email', 'mark as read', 'label', 'archive', 'organize inbox', 'sort email', 'pull my email', 'get my email', 'check email', 'find email', 'gsc', 'search console', 'seo report', 'seo analysis', 'keyword performance', 'top pages', 'top queries', 'ranking', 'search performance', 'compare snapshot', 'save snapshot', 'search google for', 'who ranks for', 'am i ranking', 'pull my gsc', 'pull search console', 'show my seo', 'seo snapshot', 'page performance', 'keyword research', 'remember this', 'always do', 'from now on', 'never do', 'i prefer', 'my preference', 'remember that', 'research', 'investigate', 'deep dive', 'look into', 'find out about', 'what\'s the latest on', 'analyze the market', 'competitor analysis', 'market research', 'track this', 'add to my tasks', 'queue up', 'work task', 'new task'];
    const isActionRequest = actionKeywords.some(k => userText.includes(k));

    // If this looks like an action request and we have tools, use the tool loop (non-streaming)
    if ((isActionRequest || enableTools) && availableTools.length > 0) {
      console.log('Using tool loop (non-streaming) for action request');

      try {
        // Use TransformStream for real-time SSE streaming of task updates
        const { readable, writable } = new TransformStream();
        const rawWriter = writable.getWriter();
        let toolStreamClosed = false;
        const writer = {
          async write(chunk: Uint8Array) {
            if (toolStreamClosed) return;
            try {
              await rawWriter.write(chunk);
            } catch {
              toolStreamClosed = true;
            }
          },
          async close() {
            if (toolStreamClosed) return;
            toolStreamClosed = true;
            try {
              await rawWriter.close();
            } catch {
              // Client disconnected — nothing left to stream.
            }
          },
        };
        const encoder = new TextEncoder();

        // Run tool loop in background, streaming task updates as they happen
        (async () => {
          try {
            // Emit infinity router debug event if available
            if (infinityDebug) {
              await writer.write(encoder.encode(`event: infinity_router_debug\ndata: ${JSON.stringify(infinityDebug)}\n\n`));
            }
            // Emit orchestration trace (wisdom + routing decisions)
            await writer.write(encoder.encode(`event: orchestration_trace\ndata: ${JSON.stringify(orchestrationTrace)}\n\n`));

            // PHASE 3 — Planner pass (two-pass agentic routing).
            // Cheap planner produces a structured plan; integrations feed the prioritizer
            // (Tier A signal), steps stream to the UI, and the plan is appended to the
            // system message so the executor follows it. Any failure falls back silently.
            const heuristicIntents = detectServiceIntents(messages);
            let mergedIntents = heuristicIntents;
            let planTaskId: string | null = null;
            const plannerStart = Date.now();
            if (!shouldSkipPlanner(userText)) {
              // Infinity Gauntlet: load user routing prefs + admin client for telemetry.
              let gauntletPrefs = DEFAULT_PREFS;
              let gauntletAdmin: any = null;
              let gauntletRegistry: Record<string, ModelEntry> = MODEL_REGISTRY_BASE;
              try {
                const { createClient: ccGaunt } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
                gauntletAdmin = ccGaunt(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
                if (credUserId) {
                  gauntletPrefs = await loadUserPrefs(gauntletAdmin, credUserId);
                  const customs = await loadCustomModels(gauntletAdmin, credUserId);
                  gauntletRegistry = mergeRegistry(customs);
                }
              } catch (e) {
                console.warn('[Gauntlet] prefs/registry load failed, using defaults:', e);
              }
              const plan = await runPlannerPass(apiKey, userText, null, gauntletPrefs, gauntletAdmin, credUserId || undefined, gauntletRegistry);
              console.log(`[Planner] ${Date.now() - plannerStart}ms mode=${gauntletPrefs.mode} customs=${Object.keys(gauntletRegistry).length - Object.keys(MODEL_REGISTRY).length} ${plan ? `intent="${plan.intent}" integrations=[${plan.integrations.join(',')}] needsTools=${plan.needsTools}` : 'null (fallback)'}`);
              if (plan) {
                const planIntents = planToServiceIntents(plan);
                mergedIntents = [...new Set([...planIntents, ...heuristicIntents])];

                if (plan.steps.length > 0) {
                  planTaskId = crypto.randomUUID();
                  for (const step of plan.steps) {
                    try {
                      await writer.write(encoder.encode(`event: task_update\ndata: ${JSON.stringify({
                        taskId: planTaskId,
                        title: plan.intent || 'Planning',
                        step,
                        status: 'in_progress',
                      })}\n\n`));
                    } catch { /* stream closed */ }
                  }
                }

                if (plan.intent || plan.steps.length > 0) {
                  const planText = `\n\n# Execution plan (from planner)
Intent: ${plan.intent}
Steps:
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Execute these in order. Be decisive — the user has already been shown this plan.`;
                  const sysIdx = openAIMessages.findIndex(m => m.role === 'system');
                  if (sysIdx >= 0) {
                    openAIMessages[sysIdx] = {
                      ...openAIMessages[sysIdx],
                      content: (openAIMessages[sysIdx].content || '') + planText,
                    };
                  }
                }
              }
            } else {
              console.log('[Planner] skipped (chitchat fast-path)');
            }

            const result = await runToolLoop(
              modelConfig, apiKey, openAIMessages, availableTools, connMap, 10,
              async (event) => {
                try {
                  await writer.write(encoder.encode(`event: task_update\ndata: ${JSON.stringify(event)}\n\n`));
                } catch { /* stream closed */ }
              },
              userText,
              aliasMap,
              wisdomUserId,
              { apiKey: GHL_API_KEY_RESOLVED, locationId: GHL_LOCATION_ID_RESOLVED, subAccounts: GHL_SUB_ACCOUNTS_RESOLVED },
              mergedIntents,
            );

            // Mark the planner task complete once the executor returns.
            if (planTaskId) {
              try {
                await writer.write(encoder.encode(`event: task_update\ndata: ${JSON.stringify({
                  taskId: planTaskId,
                  title: 'Plan complete',
                  step: 'Plan executed',
                  status: 'done',
                })}\n\n`));
              } catch { /* stream closed */ }
            }

            // Write final content as SSE
            await writer.write(encoder.encode(`data: ${JSON.stringify({
              choices: [{ delta: { content: result.content }, finish_reason: 'stop' }],
            })}\n\n`));

            // Emit which tools ran (deduped, with display names) for UI attribution
            try {
              const uniqueTools = Array.from(new Set(result.toolsUsed || []));
              if (uniqueTools.length > 0) {
                const labeled = uniqueTools.map((name) => ({
                  name,
                  label: TOOL_DISPLAY_NAMES[name] || name.replace(/_/g, ' '),
                }));
                await writer.write(encoder.encode(`event: tools_used\ndata: ${JSON.stringify({ tools: labeled })}\n\n`));
              }
            } catch { /* best-effort */ }

            // Emit which brain handled this turn (for UI attribution)
            try {
              const usedModel = modelConfig.name;
              let source: 'your_key' | 'ozlon' = 'ozlon';
              if (credUserId) {
                const { createClient: ccProv } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
                const adminProv = ccProv(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
                const { data: row } = await adminProv
                  .from('custom_models')
                  .select('api_key_secret_name')
                  .eq('user_id', credUserId)
                  .eq('model_id', usedModel)
                  .maybeSingle();
                if (row?.api_key_secret_name?.startsWith('inline:')) source = 'your_key';
              }
              await writer.write(encoder.encode(`event: provider_used\ndata: ${JSON.stringify({
                model: usedModel,
                source,
                platform: inferPlatformFromModel(usedModel),
              })}\n\n`));
            } catch { /* best-effort */ }

            // Persist investigation payloads as artifacts (one per web_investigate call).
            // Emit `investigation_artifact` SSE so the client can render an InvestigationCard
            // under the assistant message and survive page reloads via chat_messages.metadata.
            try {
              const sessionIdForArtifact = (body.sessionId as string) || null;
              const assistantMessageId = (body.assistantMessageId as string) || null;
              if (wisdomUserId && sessionIdForArtifact && result.investigations.length > 0) {
                const { createClient: ccArt } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
                const adminArt = ccArt(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
                for (const inv of result.investigations) {
                  const inserted = await adminArt
                    .from('artifacts')
                    .insert({
                      user_id: wisdomUserId,
                      conversation_id: sessionIdForArtifact,
                      message_id: assistantMessageId,
                      type: 'investigation_report',
                      title: inv.question.slice(0, 80) || 'Investigation',
                      content: inv.payload,
                      created_by: 'ai',
                      status: 'published',
                    })
                    .select('id')
                    .maybeSingle();
                  const artifactId = inserted.data?.id;
                  if (artifactId) {
                    await writer.write(encoder.encode(`event: investigation_artifact\ndata: ${JSON.stringify({
                      artifact_id: artifactId,
                      message_id: assistantMessageId,
                      question: inv.question,
                    })}\n\n`));
                  } else if (inserted.error) {
                    console.warn('[investigation_artifact] insert failed:', inserted.error.message);
                  }
                }
              }
            } catch (e) {
              console.warn('[investigation_artifact] persistence error:', e);
            }

            // Emit research_report artifacts so the client can render <ResearchCard />
            try {
              if (result.researchReports && result.researchReports.length > 0) {
                const assistantMessageId = (body.assistantMessageId as string) || null;
                for (const r of result.researchReports) {
                  await writer.write(encoder.encode(`event: research_artifact\ndata: ${JSON.stringify({
                    report_id: r.reportId,
                    message_id: assistantMessageId,
                    query: r.query,
                    confidence: r.confidence,
                  })}\n\n`));
                }
              }
            } catch (e) {
              console.warn('[research_artifact] emit error:', e);
            }

            // Emit orchestration trace before DONE so the client can attach it to the message
            await writer.write(encoder.encode(`event: orchestration_trace\ndata: ${JSON.stringify(orchestrationTrace)}\n\n`));
            await writer.write(encoder.encode('data: [DONE]\n\n'));

            // Fire-and-forget: post-turn memory extraction + recurrence updates + telemetry
            if (wisdomUserId) {
              extractPostTurnMemories(messages, result.content, wisdomUserId).catch(e =>
                console.error('[PostTurnMemory] Error:', e)
              );
              updateWisdomRecurrence(result.content || '').catch(() => {});
              try {
                const { createClient: ccLog } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
                const adminLog = ccLog(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
                adminLog.from('model_calls').insert({
                  user_id: wisdomUserId,
                  session_id: (body.sessionId as string) || null,
                  model: modelConfig.name,
                  lane: 'tools',
                  latency_ms: Date.now() - requestStart,
                  tool_used: result.toolsUsed?.join(',') || null,
                }).then(() => {});
              } catch { /* ignore */ }
            }
          } catch (e) {
            console.error('Tool loop error:', e);
            await writer.write(encoder.encode(`data: ${JSON.stringify({
              choices: [{ delta: { content: 'I encountered an error while executing that task. Please try again.' }, finish_reason: 'stop' }],
            })}\n\n`));
            await writer.write(encoder.encode('data: [DONE]\n\n'));
          } finally {
            await writer.close();
          }
        })();

        return new Response(readable, {
          headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
        });
      } catch (e) {
        console.error('Tool loop setup error:', e);
        // Fall through to streaming if tool loop fails
      }
    }

    // Standard streaming response (no tools needed)
    // STONE SOCKET: if the user has plugged in their own key for this model,
    // route the call through their gateway/key instead of the Lovable baseline.
    let streamApiKey = apiKey;
    let streamEndpoint = modelConfig.apiEndpoint;
    let providerSource: 'your_key' | 'ozlon' = 'ozlon';
    if (credUserId) {
      try {
        const { createClient: ccCustom } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const adminCustom = ccCustom(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: customRow } = await adminCustom
          .from('custom_models')
          .select('api_key_secret_name, gateway_url, enabled')
          .eq('user_id', credUserId)
          .eq('model_id', modelConfig.name)
          .eq('enabled', true)
          .maybeSingle();
        if (customRow?.api_key_secret_name?.startsWith('inline:')) {
          streamApiKey = customRow.api_key_secret_name.slice('inline:'.length);
          if (customRow.gateway_url) streamEndpoint = customRow.gateway_url;
          providerSource = 'your_key';
          console.log(`[StoneSocket] Using user's own key for ${modelConfig.name} via ${streamEndpoint}`);
        }
      } catch (e) {
        console.warn('[StoneSocket] custom_models lookup failed:', e);
      }
    }

    const requestPayload: Record<string, unknown> = {
      model: modelConfig.name,
      messages: openAIMessages,
      max_completion_tokens: modelConfig.maxTokens,
      stream: true,
    };

    const response = await fetch(streamEndpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${streamApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Upstream API error:', response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'AI service error', details: errorText }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Wrap upstream stream so we can prepend infinity-debug and append provider_used.
    const { readable, writable } = new TransformStream();
    const rawWriter = writable.getWriter();
    let streamClosed = false;
    const writer = {
      async write(chunk: Uint8Array) {
        if (streamClosed) return;
        try {
          await rawWriter.write(chunk);
        } catch {
          streamClosed = true;
        }
      },
      async close() {
        if (streamClosed) return;
        streamClosed = true;
        try {
          await rawWriter.close();
        } catch {
          // Client disconnected — nothing left to stream.
        }
      },
    };
    const encoder = new TextEncoder();
    const providerEvent = `event: provider_used\ndata: ${JSON.stringify({
      model: modelConfig.name,
      source: providerSource,
      platform: inferPlatformFromModel(modelConfig.name),
    })}\n\n`;
    (async () => {
      try {
        if (infinityDebug) {
          await writer.write(encoder.encode(`event: infinity_router_debug\ndata: ${JSON.stringify(infinityDebug)}\n\n`));
        }
        // Emit orchestration trace (wisdom + routing decisions)
        await writer.write(encoder.encode(`event: orchestration_trace\ndata: ${JSON.stringify(orchestrationTrace)}\n\n`));
        // Emit provider_used up-front so the UI can attribute even if the user closes early.
        await writer.write(encoder.encode(providerEvent));
        const reader = response.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      } finally {
        await writer.close();
      }
    })();
    return new Response(readable, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    console.error('Chat function error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
