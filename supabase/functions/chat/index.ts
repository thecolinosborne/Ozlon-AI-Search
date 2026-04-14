import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
// MATON GATEWAY
// ============================================================================

const MATON_CTRL_URL = 'https://ctrl.maton.ai';
const MATON_GATEWAY_URL = 'https://gateway.maton.ai';

interface MatonConnection {
  app: string;
  connection_id: string;
  status: string;
  metadata?: Record<string, unknown>;
}

// Multi-account connection support
type ConnEntry = { id: string; email?: string; meta?: Record<string, unknown> };
type MultiConnMap = Map<string, ConnEntry[]>;

// ---------- Dynamic alias map ----------

/** For each connected account, derive searchable aliases from email/metadata */
type AliasEntry = { alias: string; email: string; connEntry: ConnEntry };

function buildDynamicAliasMap(connMap: MultiConnMap): AliasEntry[] {
  const aliases: AliasEntry[] = [];
  for (const [, entries] of connMap) {
    for (const entry of entries) {
      if (!entry.email) continue;
      const email = entry.email.toLowerCase();
      const [localPart, fullDomain] = email.split('@');
      const domainParts = fullDomain?.split('.') || [];
      const domainName = domainParts[0] || ''; // "ozlon" from "ozlon.net"

      // Add all derived aliases
      aliases.push({ alias: email, email, connEntry: entry }); // full email
      if (localPart) aliases.push({ alias: localPart, email, connEntry: entry }); // "colin"
      if (fullDomain) aliases.push({ alias: fullDomain, email, connEntry: entry }); // "ozlon.net"
      if (domainName && domainName.length >= 3) aliases.push({ alias: domainName, email, connEntry: entry }); // "ozlon"
      // Multi-word domain like "colinosborne" → also add
      if (domainName && domainName !== localPart && domainName.length >= 3) {
        aliases.push({ alias: domainName, email, connEntry: entry });
      }

      // Also index metadata fields like displayName
      if (entry.meta) {
        const displayName = (entry.meta as Record<string, string>).displayName;
        if (displayName && displayName.length >= 3) {
          aliases.push({ alias: displayName.toLowerCase(), email, connEntry: entry });
        }
      }
    }
  }
  return aliases;
}

// ---------- Robust account resolver ----------

/** Extract an email address from a freeform string like "colin@ozlon.net gmail" */
function extractEmailFromHint(hint: string): string | null {
  const match = hint.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

/** Extract an email address mentioned in a user message */
function extractAccountFromMessage(message: string): string | null {
  const emails = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi);
  return emails ? emails[0].toLowerCase() : null;
}

/** Normalize a hint for partial matching: lowercase, strip spaces/punctuation/trailing words */
function normalizeHint(hint: string): string {
  return hint.toLowerCase().replace(/\s*(gmail|email|mail|inbox|account)\s*/gi, '').trim();
}

/**
 * Extract the best account hint from a user message using the dynamic alias map.
 * Scans for known aliases (domain names, local parts) in the message text.
 */
function extractAliasHintFromMessage(message: string, aliasMap: AliasEntry[], app: string): ConnEntry | undefined {
  const lower = message.toLowerCase();

  // First check for explicit email addresses
  const emailInMsg = extractAccountFromMessage(message);
  if (emailInMsg) {
    const match = aliasMap.find(a => a.email === emailInMsg && a.connEntry.id);
    if (match) return match.connEntry;
  }

  // Then scan for domain/alias keywords — but only match entries for the requested app
  // Get entries for this app to filter aliases
  const appEntryIds = new Set<string>();
  // We can't filter by app here since aliasMap is flat, so we match any and let caller validate

  // Sort aliases by length descending so longer/more specific matches win
  const sorted = [...aliasMap].sort((a, b) => b.alias.length - a.alias.length);
  for (const entry of sorted) {
    // Skip very short aliases that cause false positives (e.g. "colin" matching "colonial")
    if (entry.alias.length < 4 && !entry.alias.includes('@')) continue;
    // Check if the alias appears as a word boundary match
    const regex = new RegExp(`\\b${entry.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) return entry.connEntry;
  }

  return undefined;
}

/**
 * Resolve the correct connection for a service, supporting:
 * - exact email match (case-insensitive)
 * - email extracted from freeform hint ("colin@ozlon.net gmail")
 * - dynamic alias matching from alias map
 * - partial/alias match ("ozlon" matches "colin@ozlon.net")
 * - fallback extraction from the latest user message
 * Returns { id, email } so callers can confirm which account was used.
 */
function resolveConnection(
  connMap: MultiConnMap,
  app: string,
  hint?: string,
  userMessage?: string,
  aliasMap?: AliasEntry[],
): { id: string; email?: string } | undefined {
  const entries = connMap.get(app);
  if (!entries?.length) return undefined;
  if (entries.length === 1) return entries[0];

  // Priority 1: explicit tool arg hint
  if (hint) {
    const found = matchEntry(entries, hint);
    if (found) return found;
  }

  // Priority 2: dynamic alias extraction from user message
  if (userMessage && aliasMap) {
    const aliasMatch = extractAliasHintFromMessage(userMessage, aliasMap, app);
    if (aliasMatch) {
      // Verify this entry belongs to the requested app
      const appMatch = entries.find(e => e.id === aliasMatch.id);
      if (appMatch) return appMatch;
    }
  }

  // Priority 3: extract email from latest user message (fallback)
  if (userMessage) {
    const msgEmail = extractAccountFromMessage(userMessage);
    if (msgEmail) {
      const found = matchEntry(entries, msgEmail);
      if (found) return found;
    }
    // Try partial/alias match against user message words
    const normalized = userMessage.toLowerCase();
    for (const entry of entries) {
      if (!entry.email) continue;
      const domain = entry.email.split('@')[1]?.split('.')[0];
      if (domain && domain.length >= 3 && normalized.includes(domain)) return entry;
    }
  }

  // Priority 4: do NOT default — return undefined to force clarification
  // Only default if no multi-account ambiguity exists
  return undefined;
}

function matchEntry(entries: ConnEntry[], hint: string): ConnEntry | undefined {
  const hintLower = hint.toLowerCase().trim();

  // Try exact email match
  const exactMatch = entries.find(e => e.email?.toLowerCase() === hintLower);
  if (exactMatch) return exactMatch;

  // Try extracting an email from the hint string
  const extracted = extractEmailFromHint(hint);
  if (extracted) {
    const emailMatch = entries.find(e => e.email?.toLowerCase() === extracted);
    if (emailMatch) return emailMatch;
  }

  // Try partial/alias match (e.g. "ozlon" matches "colin@ozlon.net")
  const norm = normalizeHint(hint);
  if (norm.length >= 3) {
    for (const entry of entries) {
      if (!entry.email) continue;
      if (entry.email.toLowerCase().includes(norm)) return entry;
      const domain = entry.email.split('@')[1]?.split('.')[0];
      if (domain && norm.includes(domain)) return entry;
      const localPart = entry.email.split('@')[0];
      if (localPart && norm.includes(localPart)) return entry;
    }
  }

  // Check metadata fields
  for (const entry of entries) {
    if (!entry.meta) continue;
    const metaStr = JSON.stringify(entry.meta).toLowerCase();
    if (metaStr.includes(hintLower) || (extracted && metaStr.includes(extracted))) return entry;
  }

  return undefined;
}

function buildMultiConnMap(connections: MatonConnection[]): MultiConnMap {
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

async function getMatonConnections(matonApiKey: string): Promise<MatonConnection[]> {
  try {
    const res = await fetch(`${MATON_CTRL_URL}/connections`, {
      headers: { 'Authorization': `Bearer ${matonApiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.error(`[Maton] Failed to fetch connections: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const active = (data.connections || []).filter((c: MatonConnection) => c.status === 'ACTIVE');
    console.log(`[Maton] ${active.length} active connections loaded`);
    return active;
  } catch (e) {
    console.error(`[Maton] Connection fetch error:`, e);
    return [];
  }
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
  let data: unknown;
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    data = { raw: await res.text() };
  }
  if (!res.ok) {
    console.error(`[Maton Gateway] ${method} ${path} failed (${res.status}):`, JSON.stringify(data));
    throw new Error(`Maton API error ${res.status} on ${path}: ${JSON.stringify(data).substring(0, 200)}`);
  }
  return data;
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
  { app: 'google-ads', label: 'Google Ads', keywords: ['google ads', 'adwords', 'ad campaign', 'ad spend', 'ppc', 'cost per click', 'ad performance', 'campaigns', 'ad groups'] },
  { app: 'google-analytics-data', label: 'Google Analytics', keywords: ['analytics', 'google analytics', 'ga4', 'page views', 'sessions', 'bounce rate', 'visitors', 'website traffic', 'site traffic', 'user behavior'] },
  { app: 'slack', label: 'Slack', keywords: ['slack', 'slack message', 'channel', 'channels', 'dm', 'direct message', 'workspace'] },
  { app: 'notion', label: 'Notion', keywords: ['notion', 'notion page', 'notion database', 'wiki', 'notes'] },
  { app: 'airtable', label: 'Airtable', keywords: ['airtable', 'base', 'airtable base', 'airtable table'] },
  { app: 'hubspot', label: 'HubSpot', keywords: ['hubspot', 'crm', 'contacts', 'deals', 'pipeline', 'leads', 'sales pipeline'] },
  { app: 'quickbooks-online', label: 'QuickBooks', keywords: ['quickbooks', 'accounting', 'invoices', 'expenses', 'profit', 'loss', 'revenue', 'bookkeeping', 'p&l', 'balance sheet'] },
  { app: 'stripe', label: 'Stripe', keywords: ['stripe', 'payments', 'charges', 'subscriptions', 'mrr', 'revenue', 'customers', 'payment'] },
  { app: 'shopify', label: 'Shopify', keywords: ['shopify', 'store', 'orders', 'products', 'inventory', 'ecommerce', 'e-commerce', 'sales'] },
  { app: 'trello', label: 'Trello', keywords: ['trello', 'trello board', 'cards', 'trello cards'] },
  { app: 'asana', label: 'Asana', keywords: ['asana', 'asana task', 'asana project'] },
  { app: 'clickup', label: 'ClickUp', keywords: ['clickup', 'click up', 'clickup task', 'clickup tasks', 'task management'] },
  { app: 'jira', label: 'Jira', keywords: ['jira', 'jira ticket', 'jira issue', 'sprint', 'backlog'] },
  { app: 'github', label: 'GitHub', keywords: ['github', 'pull request', 'pr', 'commit', 'commits', 'repository', 'repo', 'issues', 'merge'] },
  { app: 'microsoft-teams', label: 'Microsoft Teams', keywords: ['teams', 'microsoft teams', 'ms teams'] },
  { app: 'zoom', label: 'Zoom', keywords: ['zoom', 'zoom meeting', 'zoom call', 'video call'] },
  { app: 'discord', label: 'Discord', keywords: ['discord', 'discord server', 'discord channel'] },
  { app: 'typeform', label: 'Typeform', keywords: ['typeform', 'form responses', 'survey', 'survey responses'] },
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
// SERVICE DATA FETCHERS (READ)
// ============================================================================

async function fetchGSCData(key: string, connId: string): Promise<string> {
  console.log(`[GSC] Fetching sites with connection ${connId}`);
  let sitesData: { siteEntry?: { siteUrl: string; permissionLevel?: string }[] };
  try {
    sitesData = await callMatonGateway(key, '/google-search-console/webmasters/v3/sites', connId) as typeof sitesData;
  } catch (e) {
    console.error('[GSC] Failed to fetch sites:', e);
    return `❌ Failed to fetch GSC sites: ${e instanceof Error ? e.message : 'Unknown error'}. The connection may need to be re-authorized.`;
  }
  const sites = sitesData.siteEntry || [];
  if (!sites.length) return '⚠️ No sites found in Google Search Console. Make sure your GSC account has verified properties.';
  console.log(`[GSC] Found ${sites.length} sites: ${sites.map(s => s.siteUrl).join(', ')}`);
  const recentEnd = new Date(); recentEnd.setDate(recentEnd.getDate() - 2);
  const recentStart = new Date(); recentStart.setDate(recentStart.getDate() - 8);
  const priorEnd = new Date(); priorEnd.setDate(priorEnd.getDate() - 9);
  const priorStart = new Date(); priorStart.setDate(priorStart.getDate() - 15);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const reports: string[] = [];
  for (const site of sites) {
    try {
      const [recentQueryData, priorQueryData, recentPageData, recentDateData] = await Promise.all([
        callMatonGateway(key, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`, connId, 'POST', { startDate: fmt(recentStart), endDate: fmt(recentEnd), dimensions: ['query'], rowLimit: 50 }),
        callMatonGateway(key, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`, connId, 'POST', { startDate: fmt(priorStart), endDate: fmt(priorEnd), dimensions: ['query'], rowLimit: 50 }),
        callMatonGateway(key, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`, connId, 'POST', { startDate: fmt(recentStart), endDate: fmt(recentEnd), dimensions: ['page'], rowLimit: 25 }),
        callMatonGateway(key, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`, connId, 'POST', { startDate: fmt(recentStart), endDate: fmt(recentEnd), dimensions: ['date'], rowLimit: 7 }),
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
      reports.push(`### ${site.siteUrl}\n❌ Error: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }
  return reports.join('\n');
}

async function fetchGmailData(key: string, connId: string): Promise<string> {
  // Fetch latest emails chronologically (all mail, not just unread) + unread count
  const [recentData, unreadData] = await Promise.all([
    callMatonGateway(key, '/google-mail/gmail/v1/users/me/messages?maxResults=20', connId) as Promise<{ messages?: { id: string }[]; resultSizeEstimate?: number }>,
    callMatonGateway(key, '/google-mail/gmail/v1/users/me/messages?maxResults=1&q=is:unread', connId).catch(() => ({})) as Promise<{ resultSizeEstimate?: number }>,
  ]);
  const msgs = recentData.messages || [];
  if (!msgs.length) return 'Inbox is empty.';
  const unreadCount = unreadData.resultSizeEstimate || 0;
  const details: string[] = [`Latest emails (newest first) | Unread: ~${unreadCount}`];
  // Fetch metadata in parallel for speed
  const batch = msgs.slice(0, 15);
  const results = await Promise.all(batch.map(async (m) => {
    try {
      const full = await callMatonGateway(key, `/google-mail/gmail/v1/users/me/messages/${m.id}?format=full&fields=payload/headers,snippet,labelIds`, connId) as { payload?: { headers?: { name: string; value: string }[] }; snippet?: string; labelIds?: string[] };
      const headers = full.payload?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const date = headers.find(h => h.name === 'Date')?.value || '';
      const unread = (full.labelIds || []).includes('UNREAD') ? ' [UNREAD]' : '';
      return `- ID: ${m.id} | From: ${from} | Subject: ${subject} | ${date}${unread}\n  Preview: ${(full.snippet || '').substring(0, 120)}`;
    } catch { return `- ID: ${m.id}: could not load`; }
  }));
  details.push(...results);
  return details.join('\n');
}

async function fetchCalendarData(key: string, connId: string): Promise<string> {
  const now = new Date();
  const end = new Date(); end.setDate(end.getDate() + 7);
  const data = await callMatonGateway(key, `/google-calendar/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`, connId) as { items?: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }[] };
  const events = data.items || [];
  if (!events.length) return 'No upcoming events in the next 7 days.';
  return events.map(e => `- ${e.summary || '(no title)'} | ${e.start?.dateTime || e.start?.date || 'TBD'}${e.location ? ' | ' + e.location : ''}`).join('\n');
}

async function fetchGoogleDriveData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/google-drive/drive/v3/files?pageSize=15&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)', connId) as { files?: { name: string; mimeType: string; modifiedTime: string }[] };
  const files = data.files || [];
  if (!files.length) return 'No recent files.';
  return files.map(f => `- ${f.name} (${f.mimeType?.split('.').pop() || 'file'}) - modified ${f.modifiedTime}`).join('\n');
}

async function fetchSlackData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/slack/api/conversations.list?types=public_channel,private_channel&limit=10', connId) as { channels?: { name: string; id: string; num_members?: number }[] };
  const channels = data.channels || [];
  return `Channels (${channels.length}):\n${channels.map(c => `- #${c.name} (ID: ${c.id}, ${c.num_members || '?'} members)`).join('\n')}`;
}

async function fetchHubSpotData(key: string, connId: string): Promise<string> {
  const [contacts, deals] = await Promise.all([
    callMatonGateway(key, '/hubspot/crm/v3/objects/contacts?limit=10&properties=firstname,lastname,email,createdate', connId) as Promise<{ results?: { properties?: Record<string, string> }[] }>,
    callMatonGateway(key, '/hubspot/crm/v3/objects/deals?limit=10&properties=dealname,amount,dealstage,createdate', connId) as Promise<{ results?: { properties?: Record<string, string> }[] }>,
  ]);
  const c = (contacts.results || []).map(r => `- ${r.properties?.firstname || ''} ${r.properties?.lastname || ''} (${r.properties?.email || 'no email'})`).join('\n');
  const d = (deals.results || []).map(r => `- ${r.properties?.dealname || 'Untitled'}: $${r.properties?.amount || '0'} (${r.properties?.dealstage || 'unknown'})`).join('\n');
  return `Contacts:\n${c || 'None'}\n\nDeals:\n${d || 'None'}`;
}

async function fetchStripeData(key: string, connId: string): Promise<string> {
  const [charges, balance] = await Promise.all([
    callMatonGateway(key, '/stripe/v1/charges?limit=10', connId) as Promise<{ data?: { amount: number; currency: string; status: string; created: number; description?: string }[] }>,
    callMatonGateway(key, '/stripe/v1/balance', connId) as Promise<{ available?: { amount: number; currency: string }[]; pending?: { amount: number; currency: string }[] }>,
  ]);
  const bal = (balance.available || []).map(b => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ');
  const recent = (charges.data || []).map(c => `- $${(c.amount / 100).toFixed(2)} ${c.currency.toUpperCase()} - ${c.status} (${new Date(c.created * 1000).toLocaleDateString()})`).join('\n');
  return `Balance: ${bal || 'N/A'}\n\nRecent charges:\n${recent || 'None'}`;
}

async function fetchShopifyData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/shopify/admin/api/2024-01/orders.json?status=any&limit=10', connId) as { orders?: { name: string; total_price: string; created_at: string; financial_status: string }[] };
  const orders = data.orders || [];
  if (!orders.length) return 'No recent orders.';
  return orders.map(o => `- ${o.name}: $${o.total_price} (${o.financial_status}) - ${new Date(o.created_at).toLocaleDateString()}`).join('\n');
}

async function fetchNotionData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/notion/v1/search', connId, 'POST', { page_size: 10, sort: { direction: 'descending', timestamp: 'last_edited_time' } }) as { results?: { object: string; properties?: Record<string, unknown>; last_edited_time?: string }[] };
  const results = data.results || [];
  if (!results.length) return 'No recent Notion pages.';
  return results.map(r => {
    const titleProp = r.properties ? Object.values(r.properties).find((p: unknown) => (p as Record<string, unknown>)?.type === 'title') as { title?: { plain_text?: string }[] } | undefined : undefined;
    const title = titleProp?.title?.[0]?.plain_text || '(untitled)';
    return `- ${r.object}: ${title} (edited ${r.last_edited_time || 'unknown'})`;
  }).join('\n');
}

async function fetchGitHubData(key: string, connId: string): Promise<string> {
  const [notifications, repos] = await Promise.all([
    callMatonGateway(key, '/github/notifications?per_page=10', connId) as Promise<{ subject?: { title?: string; type?: string }; reason?: string }[]>,
    callMatonGateway(key, '/github/user/repos?sort=updated&per_page=5', connId) as Promise<{ full_name: string; updated_at: string; open_issues_count?: number }[]>,
  ]);
  const notifs = Array.isArray(notifications) ? notifications.map(n => `- ${n.subject?.type || '?'}: ${n.subject?.title || '?'} (${n.reason})`).join('\n') : 'No notifications';
  const repoList = Array.isArray(repos) ? repos.map(r => `- ${r.full_name} (updated ${r.updated_at}, ${r.open_issues_count || 0} issues)`).join('\n') : 'No repos';
  return `Notifications:\n${notifs}\n\nRecent repos:\n${repoList}`;
}

// ---------- Google Docs ----------
async function fetchGoogleDocsData(key: string, connId: string): Promise<string> {
  // Docs API doesn't have a list endpoint; use Drive to find docs
  const data = await callMatonGateway(key, "/google-drive/drive/v3/files?q=mimeType%3D'application/vnd.google-apps.document'&pageSize=15&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,webViewLink)", connId) as { files?: { id: string; name: string; modifiedTime: string; webViewLink?: string }[] };
  const files = data.files || [];
  if (!files.length) return 'No Google Docs found.';
  return files.map(f => `- [${f.name}](${f.webViewLink || `https://docs.google.com/document/d/${f.id}/edit`}) — modified ${f.modifiedTime}`).join('\n');
}

// ---------- Google Sheets ----------
async function fetchGoogleSheetsData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, "/google-drive/drive/v3/files?q=mimeType%3D'application/vnd.google-apps.spreadsheet'&pageSize=15&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,webViewLink)", connId) as { files?: { id: string; name: string; modifiedTime: string; webViewLink?: string }[] };
  const files = data.files || [];
  if (!files.length) return 'No Google Sheets found.';
  return files.map(f => `- [${f.name}](${f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`}) — modified ${f.modifiedTime}`).join('\n');
}

// ---------- Google Slides ----------
async function fetchGoogleSlidesData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, "/google-drive/drive/v3/files?q=mimeType%3D'application/vnd.google-apps.presentation'&pageSize=15&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,webViewLink)", connId) as { files?: { id: string; name: string; modifiedTime: string; webViewLink?: string }[] };
  const files = data.files || [];
  if (!files.length) return 'No Google Slides found.';
  return files.map(f => `- [${f.name}](${f.webViewLink || `https://docs.google.com/presentation/d/${f.id}/edit`}) — modified ${f.modifiedTime}`).join('\n');
}

// ---------- YouTube ----------
async function fetchYouTubeData(key: string, connId: string): Promise<string> {
  try {
    const channelData = await callMatonGateway(key, '/youtube/youtube/v3/channels?part=snippet,statistics&mine=true', connId) as { items?: { snippet?: { title?: string }; statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string } }[] };
    const ch = channelData.items?.[0];
    let result = '';
    if (ch) {
      result += `**Channel:** ${ch.snippet?.title || 'Unknown'}\n`;
      result += `Subscribers: ${ch.statistics?.subscriberCount || '?'} | Videos: ${ch.statistics?.videoCount || '?'} | Total views: ${ch.statistics?.viewCount || '?'}\n\n`;
    }
    const videosData = await callMatonGateway(key, '/youtube/youtube/v3/search?part=snippet&forMine=true&type=video&maxResults=10&order=date', connId) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; publishedAt?: string } }[] };
    const vids = videosData.items || [];
    if (vids.length) {
      result += 'Recent uploads:\n';
      result += vids.map(v => `- [${v.snippet?.title || '(untitled)'}](https://youtube.com/watch?v=${v.id?.videoId}) — ${v.snippet?.publishedAt || ''}`).join('\n');
    }
    return result || 'YouTube connected but no channel data found.';
  } catch (e) { return `YouTube error: ${e instanceof Error ? e.message : 'Unknown'}`; }
}

// ---------- Google Meet (via Calendar) ----------
async function fetchGoogleMeetData(key: string, connId: string): Promise<string> {
  const now = new Date();
  const end = new Date(); end.setDate(end.getDate() + 14);
  const data = await callMatonGateway(key, `/google-calendar/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20&q=meet.google.com`, connId) as { items?: { summary?: string; start?: { dateTime?: string; date?: string }; hangoutLink?: string; htmlLink?: string }[] };
  const events = data.items || [];
  if (!events.length) return 'No upcoming Google Meet meetings found.';
  return events.map(e => `- ${e.summary || '(no title)'} | ${e.start?.dateTime || e.start?.date || 'TBD'} | ${e.hangoutLink || e.htmlLink || ''}`).join('\n');
}

// ---------- ClickUp ----------
async function fetchClickUpData(key: string, connId: string): Promise<string> {
  const teamsData = await callMatonGateway(key, '/clickup/api/v2/team', connId) as { teams?: { id: string; name: string }[] };
  const teams = teamsData.teams || [];
  if (!teams.length) return 'No ClickUp workspaces found.';
  const sections: string[] = [];
  for (const team of teams.slice(0, 2)) {
    const spacesData = await callMatonGateway(key, `/clickup/api/v2/team/${team.id}/space?archived=false`, connId) as { spaces?: { id: string; name: string }[] };
    const spaces = spacesData.spaces || [];
    let teamSection = `**Workspace:** ${team.name}\n`;
    for (const space of spaces.slice(0, 3)) {
      teamSection += `  Space: ${space.name}\n`;
      try {
        const listsData = await callMatonGateway(key, `/clickup/api/v2/space/${space.id}/list`, connId) as { lists?: { id: string; name: string; task_count?: number }[] };
        const lists = listsData.lists || [];
        for (const list of lists.slice(0, 3)) {
          teamSection += `    - ${list.name} (${list.task_count || 0} tasks)\n`;
        }
      } catch { teamSection += '    - Could not load lists\n'; }
    }
    sections.push(teamSection);
  }
  return sections.join('\n');
}

// ---------- Google Analytics (GA4) ----------
async function fetchGoogleAnalyticsData(key: string, connId: string): Promise<string> {
  try {
    // List GA4 properties
    const accountsData = await callMatonGateway(key, '/google-analytics-data/analytics/admin/v1beta/accountSummaries', connId) as { accountSummaries?: { account?: string; displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[] };
    const accounts = accountsData.accountSummaries || [];
    if (!accounts.length) return 'No Google Analytics accounts found.';
    const prop = accounts[0]?.propertySummaries?.[0];
    if (!prop?.property) return 'No GA4 properties found.';
    const propertyId = prop.property.replace('properties/', '');
    // Run a basic report
    const reportData = await callMatonGateway(key, `/google-analytics-data/analytics/data/v1beta/properties/${propertyId}:runReport`, connId, 'POST', {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'bounceRate' }],
      dimensions: [{ name: 'date' }],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
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

async function fetchGenericData(key: string, connId: string, app: string): Promise<string> {
  const endpoints: Record<string, string> = {
    'trello': '/trello/1/members/me/boards?fields=name,dateLastActivity',
    'asana': '/asana/api/1.0/users/me/user_task_list',
    'jira': '/jira/rest/api/3/myself',
    'google-ads': '/google-ads/v17/customers:listAccessibleCustomers',
  };
  if (!endpoints[app]) return `${app} connected but no specific fetcher configured.`;
  try {
    const data = await callMatonGateway(key, endpoints[app], connId);
    return JSON.stringify(data, null, 2).substring(0, 2000);
  } catch (e) { return `Could not fetch ${app} data: ${e instanceof Error ? e.message : 'Unknown'}`; }
}

const SERVICE_FETCHERS: Record<string, (key: string, connId: string) => Promise<string>> = {
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
  'slack': fetchSlackData,
  'hubspot': fetchHubSpotData,
  'stripe': fetchStripeData,
  'shopify': fetchShopifyData,
  'notion': fetchNotionData,
  'github': fetchGitHubData,
  'google-ads': (k, c) => fetchGenericData(k, c, 'google-ads'),
  'trello': (k, c) => fetchGenericData(k, c, 'trello'),
  'asana': (k, c) => fetchGenericData(k, c, 'asana'),
  'jira': (k, c) => fetchGenericData(k, c, 'jira'),
};

// ============================================================================
// MATON DATA INJECTION (READ)
// ============================================================================

async function injectMatonData(
  messages: { role: string; content: string }[],
  matonApiKey: string,
  multiConnMap?: MultiConnMap,
  aliasMap?: AliasEntry[],
): Promise<string> {
  const detectedApps = detectServiceIntents(messages);
  if (!detectedApps.length) return '';
  console.log('Detected service intents:', detectedApps);

  // Extract account hint from latest user message
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const userMessageText = lastUserMsg?.content || '';

  // Build a simple connMap for fetchers, account-aware for multi-account services
  let connMap: Map<string, string>;
  if (multiConnMap) {
    connMap = new Map();
    for (const [app, entries] of multiConnMap) {
      if (!entries.length) continue;
      if (entries.length === 1) {
        connMap.set(app, entries[0].id);
      } else {
        // For multi-account services, resolve using dynamic alias map + user message
        const resolved = resolveConnection(multiConnMap, app, undefined, userMessageText, aliasMap);
        if (resolved) {
          connMap.set(app, resolved.id);
          console.log(`Multi-account resolved for ${app}: ${resolved.email || resolved.id}`);
        } else {
          // No clear account specified — don't inject any single account's data
          // Instead, we'll note which accounts are available
          console.log(`Multi-account ambiguous for ${app}, skipping data injection`);
        }
      }
    }
  } else {
    const connections = await getMatonConnections(matonApiKey);
    connMap = new Map();
    for (const c of connections) { if (!connMap.has(c.app)) connMap.set(c.app, c.connection_id); }
  }

  const sections: string[] = [];
  const notConnected: string[] = [];
  const ambiguousAccounts: { app: string; accounts: string[] }[] = [];

  // Fallback mapping: services that use another connection's credentials
  const CONNECTION_FALLBACKS: Record<string, string[]> = {
    'google-docs': ['google-drive'],
    'google-sheets': ['google-drive'],
    'google-slides': ['google-drive'],
    'google-meet': ['google-calendar'],
  };

  await Promise.all(detectedApps.map(async (app) => {
    let connId = connMap.get(app);
    // Try fallback connections if primary isn't found
    if (!connId && CONNECTION_FALLBACKS[app]) {
      for (const fallback of CONNECTION_FALLBACKS[app]) {
        connId = connMap.get(fallback);
        if (connId) break;
      }
    }
    if (!connId) {
      // Check if this is because of ambiguous multi-account
      const entries = multiConnMap?.get(app);
      if (entries && entries.length > 1) {
        ambiguousAccounts.push({
          app: SERVICE_DETECTORS.find(s => s.app === app)?.label || app,
          accounts: entries.map(e => e.email || e.id),
        });
        return;
      }
      notConnected.push(SERVICE_DETECTORS.find(s => s.app === app)?.label || app);
      return;
    }
    const fetcher = SERVICE_FETCHERS[app];
    if (!fetcher) { sections.push(`## ${app}\nConnected but no data fetcher configured.`); return; }
    try {
      const data = await fetcher(matonApiKey, connId);
      // For multi-account services, indicate which account the data came from
      const entries = multiConnMap?.get(app);
      let accountLabel = '';
      if (entries && entries.length > 1) {
        const usedEntry = entries.find(e => e.id === connId);
        accountLabel = usedEntry?.email ? ` (account: ${usedEntry.email})` : '';
      }
      sections.push(`## ${SERVICE_DETECTORS.find(s => s.app === app)?.label || app}${accountLabel}\n${data}`);
      console.log(`${app} data injected${accountLabel}`);
    } catch (e) {
      console.error(`Error fetching ${app}:`, e);
      sections.push(`## ${app}\nError: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }));

  if (!sections.length && !notConnected.length && !ambiguousAccounts.length) return '';

  let injection = `\n\n===========================================================
LIVE DATA FROM CONNECTED SERVICES
===========================================================
The following is REAL data pulled from the user's connected accounts. Use this data to answer with specific numbers, dates, and details.\n\n`;
  injection += sections.join('\n\n');
  if (ambiguousAccounts.length) {
    injection += `\n\nIMPORTANT: The user asked about ${ambiguousAccounts.map(a => a.app).join(', ')} but has MULTIPLE accounts connected. You did NOT pre-load data for these because the account was ambiguous. Ask the user which account to use:\n`;
    for (const a of ambiguousAccounts) {
      injection += `- ${a.app}: ${a.accounts.join(', ')}\n`;
    }
  }
  if (notConnected.length) {
    injection += `\n\nNote: The user asked about ${notConnected.join(', ')} but ${notConnected.length === 1 ? "it isn't" : "they aren't"} connected yet. Let them know they can connect in Settings > Maton AI Integrations.`;
  }
  return injection;
}

// ============================================================================
// GOHIGHLEVEL DIRECT API HELPER
// ============================================================================

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

async function callGHL(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const GHL_API_KEY = Deno.env.get('GHL_API_KEY');
  if (!GHL_API_KEY) throw new Error('GHL_API_KEY not configured');
  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return { raw: await res.text() };
}

async function fetchGHLData(): Promise<string> {
  const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
  if (!GHL_LOCATION_ID) return 'GHL location not configured.';
  const sections: string[] = [];
  try {
    const [contactsData, pipelinesData, calendarsData] = await Promise.all([
      callGHL(`/contacts/?locationId=${GHL_LOCATION_ID}&limit=10`) as Promise<{ contacts?: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string }[] }>,
      callGHL(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`) as Promise<{ pipelines?: { id: string; name: string; stages?: { id: string; name: string }[] }[] }>,
      callGHL(`/calendars/?locationId=${GHL_LOCATION_ID}`) as Promise<{ calendars?: { id: string; name: string }[] }>,
    ]);
    const contacts = contactsData.contacts || [];
    if (contacts.length) sections.push(`**Recent Contacts (${contacts.length}):**\n${contacts.map(c => `- ${c.firstName || ''} ${c.lastName || ''} | ${c.email || ''} | ${c.phone || ''} | ID: ${c.id}`).join('\n')}`);
    const pipelines = pipelinesData.pipelines || [];
    if (pipelines.length) sections.push(`**Pipelines:**\n${pipelines.map(p => `- ${p.name} (ID: ${p.id}) — Stages: ${(p.stages || []).map(s => s.name).join(' → ')}`).join('\n')}`);
    const calendars = calendarsData.calendars || [];
    if (calendars.length) sections.push(`**Calendars:**\n${calendars.map(c => `- ${c.name} (ID: ${c.id})`).join('\n')}`);
  } catch (e) { sections.push(`Error: ${e instanceof Error ? e.message : 'Unknown'}`); }
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

const MATON_ACTION_TOOLS: ToolDef[] = [
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
  // Slack actions
  {
    type: 'function',
    function: {
      name: 'send_slack_message',
      description: 'Send a message to a Slack channel or user. Use when the user asks to message, notify, or post to Slack.',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Slack channel ID (e.g. C0123456) or channel name' },
          text: { type: 'string', description: 'Message text to send' },
        },
        required: ['channel', 'text'],
      },
    },
  },
  // Notion actions
  {
    type: 'function',
    function: {
      name: 'create_notion_page',
      description: 'Create a new page in Notion. Use when the user asks to create a note, document, or page in Notion.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page content as plain text' },
          parent_page_id: { type: 'string', description: 'Parent page ID to create under (optional - uses workspace root if omitted)' },
        },
        required: ['title', 'content'],
      },
    },
  },
  // GitHub actions
  {
    type: 'function',
    function: {
      name: 'create_github_issue',
      description: 'Create a new issue in a GitHub repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner (username or org)' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body/description' },
          labels: { type: 'string', description: 'Comma-separated labels (optional)' },
        },
        required: ['owner', 'repo', 'title', 'body'],
      },
    },
  },
  // HubSpot actions
  {
    type: 'function',
    function: {
      name: 'create_hubspot_contact',
      description: 'Create a new contact in HubSpot CRM.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Contact email' },
          firstname: { type: 'string', description: 'First name' },
          lastname: { type: 'string', description: 'Last name' },
          phone: { type: 'string', description: 'Phone number (optional)' },
          company: { type: 'string', description: 'Company name (optional)' },
        },
        required: ['email', 'firstname', 'lastname'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_hubspot_deal',
      description: 'Create a new deal in HubSpot CRM.',
      parameters: {
        type: 'object',
        properties: {
          dealname: { type: 'string', description: 'Deal name' },
          amount: { type: 'string', description: 'Deal amount' },
          dealstage: { type: 'string', description: 'Deal stage (e.g. appointmentscheduled, qualifiedtobuy, closedwon)' },
          pipeline: { type: 'string', description: 'Pipeline name (optional, defaults to default pipeline)' },
        },
        required: ['dealname', 'amount'],
      },
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
  // ClickUp actions
  {
    type: 'function',
    function: {
      name: 'create_clickup_task',
      description: 'Create a new task in ClickUp.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string', description: 'ClickUp list ID to create the task in' },
          name: { type: 'string', description: 'Task name' },
          description: { type: 'string', description: 'Task description (optional)' },
          priority: { type: 'number', description: 'Priority: 1=Urgent, 2=High, 3=Normal, 4=Low (optional)' },
        },
        required: ['list_id', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clickup_tasks',
      description: 'List tasks from a ClickUp list.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string', description: 'ClickUp list ID' },
        },
        required: ['list_id'],
      },
    },
  },
  // Trello actions
  {
    type: 'function',
    function: {
      name: 'create_trello_card',
      description: 'Create a new card on a Trello board.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string', description: 'Trello list ID to add the card to' },
          name: { type: 'string', description: 'Card name/title' },
          desc: { type: 'string', description: 'Card description (optional)' },
        },
        required: ['list_id', 'name'],
      },
    },
  },
  // Jira actions
  {
    type: 'function',
    function: {
      name: 'create_jira_issue',
      description: 'Create a new issue/ticket in Jira.',
      parameters: {
        type: 'object',
        properties: {
          project_key: { type: 'string', description: 'Jira project key (e.g. PROJ)' },
          summary: { type: 'string', description: 'Issue summary/title' },
          description: { type: 'string', description: 'Issue description' },
          issue_type: { type: 'string', description: 'Issue type (Task, Bug, Story, Epic). Default: Task' },
        },
        required: ['project_key', 'summary'],
      },
    },
  },
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
      description: 'List social media posts in GoHighLevel Social Planner.',
      parameters: { type: 'object', properties: {} },
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
      name: 'ghl_list_blog_posts',
      description: 'List blog posts in GoHighLevel.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 20)' } } },
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
      description: 'Create a new blog post in GoHighLevel.',
      parameters: { type: 'object', properties: { title: { type: 'string', description: 'Blog post title' }, content: { type: 'string', description: 'Blog post HTML content' }, status: { type: 'string', description: 'Status: draft or published (default: draft)' } }, required: ['title', 'content'] },
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
  {
    type: 'function',
    function: {
      name: 'deep_research',
      description: 'Perform real-time web research on any topic using Tavily search. Searches the internet, reads multiple sources, and synthesizes a structured research report with citations. Use when the user asks to research, investigate, deep dive, look into, or find information about any topic.',
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
          ai_status: { type: 'string', enum: ['thinking', 'executing', 'completed', 'failed'], description: 'Current AI processing status' },
          next_action: { type: 'string', enum: ['waiting_on_ai', 'waiting_on_human', 'ready_to_send', 'needs_review', 'blocked', 'none'], description: 'Next action state' },
          activity_entry: {
            type: 'object',
            description: 'Structured activity log entry to append',
            properties: {
              action: { type: 'string', description: 'Action identifier e.g. research_started, draft_completed' },
              detail: { type: 'string', description: 'Human-readable description of what happened' },
              status: { type: 'string', enum: ['thinking', 'executing', 'completed', 'failed'], description: 'Status of this activity' },
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
];
// ============================================================================

// --- State transition validator for work tasks ---
const VALID_TASK_TRANSITIONS: Record<string, string[]> = {
  todo: ['in_progress'],
  in_progress: ['up_for_review'],
  up_for_review: ['in_progress', 'completed'],
  completed: ['in_progress'],
};

function isValidTaskTransition(from: string, to: string): boolean {
  if (from === to) return true; // no-op is always safe
  return VALID_TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  matonApiKey: string,
  connMap: MultiConnMap,
  userMessage?: string,
  aliasMap?: AliasEntry[],
): Promise<{ success: boolean; result: string }> {
  try {
    const accountHint = args.account as string | undefined;

    // Helper: generate context-aware error when connection not found
    const noConnError = (app: string, label: string): string => {
      const entries = connMap.get(app);
      if (entries && entries.length > 1) {
        const accounts = entries.map(e => e.email || e.id).join(', ');
        return `Multiple ${label} accounts are connected (${accounts}). Please specify which account to use by including the email address in your request, then try again.`;
      }
      return `${label} is not connected. Ask the user to connect it in Settings > Maton AI Integrations.`;
    };

    switch (toolName) {
      case 'send_email': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        const raw = buildRawEmail(args.to as string, args.subject as string, args.body as string, args.cc as string | undefined);
        const res = await callMatonGateway(matonApiKey, '/google-mail/gmail/v1/users/me/messages/send', connId, 'POST', { raw }) as { id?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to send: ${res.error.message || JSON.stringify(res.error)}` };
        return { success: true, result: `[Using Gmail: ${resolved?.email || "default"}] Email sent successfully (ID: ${res.id}). To: ${args.to}, Subject: "${args.subject}"` };
      }

      case 'create_email_draft': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        const raw = buildRawEmail(args.to as string, args.subject as string, args.body as string);
        const res = await callMatonGateway(matonApiKey, '/google-mail/gmail/v1/users/me/drafts', connId, 'POST', { message: { raw } }) as { id?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create draft: ${res.error.message || JSON.stringify(res.error)}` };
        return { success: true, result: `[Using Gmail: ${resolved?.email || "default"}] Draft created successfully (ID: ${res.id}). To: ${args.to}, Subject: "${args.subject}"` };
      }

      case 'list_emails': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        const maxResults = Math.min((args.max_results as number) || 50, 100);
        const query = encodeURIComponent(args.query as string);
        const data = await callMatonGateway(matonApiKey, `/google-mail/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${query}`, connId) as { messages?: { id: string; threadId: string }[]; resultSizeEstimate?: number };
        const msgs = data.messages || [];
        if (!msgs.length) return { success: true, result: `No emails found matching "${args.query}"` };
        // Fetch metadata for each message (batch up to 50)
        const details: string[] = [`[Using Gmail: ${resolved?.email || "default"}] Found ~${data.resultSizeEstimate || msgs.length} emails. Showing ${Math.min(msgs.length, 50)}:`];
        const batch = msgs.slice(0, 50);
        const metadataResults = await Promise.all(batch.map(async (m) => {
          try {
            const full = await callMatonGateway(matonApiKey, `/google-mail/gmail/v1/users/me/messages/${m.id}?format=full&fields=payload/headers,snippet,labelIds`, connId) as { payload?: { headers?: { name: string; value: string }[] }; snippet?: string; labelIds?: string[] };
            const headers = full.payload?.headers || [];
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
            const date = headers.find(h => h.name === 'Date')?.value || '';
            return `- ID: ${m.id} | From: ${from} | Subject: ${subject} | ${date}`;
          } catch { return `- ID: ${m.id} | (metadata unavailable)`; }
        }));
        details.push(...metadataResults);
        return { success: true, result: details.join('\n') };
      }

      case 'get_email': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        const full = await callMatonGateway(matonApiKey, `/google-mail/gmail/v1/users/me/messages/${args.message_id}?format=full`, connId) as { payload?: { headers?: { name: string; value: string }[]; parts?: { mimeType?: string; body?: { data?: string } }[]; body?: { data?: string } }; snippet?: string; labelIds?: string[] };
        const headers = full.payload?.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const to = headers.find(h => h.name === 'To')?.value || '';
        // Decode body
        let bodyText = '';
        const bodyData = full.payload?.body?.data || full.payload?.parts?.find(p => p.mimeType === 'text/plain')?.body?.data;
        if (bodyData) {
          try { bodyText = atob(bodyData.replace(/-/g, '+').replace(/_/g, '/')); } catch { bodyText = full.snippet || ''; }
        } else {
          bodyText = full.snippet || '';
        }
        return { success: true, result: `From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\nLabels: ${(full.labelIds || []).join(', ')}\n\n${bodyText.substring(0, 2000)}` };
      }

      case 'trash_email': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        console.log(`[trash_email] Trashing message ${args.message_id} via connection ${connId} (${resolved?.email})`);
        try {
          const res = await callMatonGateway(matonApiKey, `/google-mail/gmail/v1/users/me/messages/${args.message_id}/trash`, connId, 'POST') as { id?: string; labelIds?: string[]; error?: { message?: string } };
          console.log(`[trash_email] Result for ${args.message_id}:`, res.error ? `ERROR: ${res.error.message}` : `OK, labels: ${(res.labelIds || []).join(',')}`);
          if (res.error) return { success: false, result: `Failed to trash: ${res.error.message || JSON.stringify(res.error)}` };
          return { success: true, result: `[Using Gmail: ${resolved?.email || "default"}] Email ${args.message_id} moved to trash.` };
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error(`[trash_email] Error trashing ${args.message_id}:`, errMsg);
          return { success: false, result: `Failed to trash email ${args.message_id}: ${errMsg}` };
        }
      }

      case 'batch_trash_emails': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        const ids = (args.message_ids as string).split(',').map(id => id.trim()).filter(Boolean);
        if (!ids.length) return { success: false, result: 'No message IDs provided.' };
        const failures: string[] = [];
        let successCount = 0;
        const chunkSize = 10;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (id) => {
            try {
              const res = await callMatonGateway(matonApiKey, `/google-mail/gmail/v1/users/me/messages/${id}/trash`, connId, 'POST') as { error?: { message?: string } };
              if (res.error) {
                failures.push(`${id}: ${res.error.message || JSON.stringify(res.error)}`);
              } else {
                successCount++;
              }
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              failures.push(`${id}: ${errMsg}`);
            }
          }));
        }
        const allFailed = successCount === 0;
        const detail = failures.length ? ` (${failures.join(', ')})` : '';
        return { success: !allFailed, result: `[Using Gmail: ${resolved?.email || "default"}] Batch trash: ${successCount} trashed, ${failures.length} failed${detail}.` };
      }

      case 'list_email_ids': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        const maxResults = Math.min((args.max_results as number) || 100, 500);
        const query = encodeURIComponent(args.query as string);
        let url = `/google-mail/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${query}`;
        if (args.page_token) url += `&pageToken=${args.page_token}`;
        const data = await callMatonGateway(matonApiKey, url, connId) as { messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number };
        const msgs = data.messages || [];
        if (!msgs.length) return { success: true, result: JSON.stringify({ ids: [], total: 0 }) };
        return { success: true, result: JSON.stringify({ ids: msgs.map(m => m.id), nextPageToken: data.nextPageToken || null, total: data.resultSizeEstimate || msgs.length }) };
      }

      case 'label_email': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        const modifyData: Record<string, string[]> = {};
        if (args.add_labels) modifyData.addLabelIds = (args.add_labels as string).split(',').map(l => l.trim());
        if (args.remove_labels) modifyData.removeLabelIds = (args.remove_labels as string).split(',').map(l => l.trim());
        const res = await callMatonGateway(matonApiKey, `/google-mail/gmail/v1/users/me/messages/${args.message_id}/modify`, connId, 'POST', modifyData) as { id?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Label modification failed: ${res.error.message || JSON.stringify(res.error)}` };
        return { success: true, result: `[Using Gmail: ${resolved?.email || "default"}] Labels updated on email ${args.message_id}.` };
      }

      case 'mark_email_read': {
        const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
        const res = await callMatonGateway(matonApiKey, `/google-mail/gmail/v1/users/me/messages/${args.message_id}/modify`, connId, 'POST', { removeLabelIds: ['UNREAD'] }) as { id?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to mark as read: ${res.error.message || JSON.stringify(res.error)}` };
        return { success: true, result: `[Using Gmail: ${resolved?.email || "default"}] Email ${args.message_id} marked as read.` };
      }

      case 'create_calendar_event': {
        const resolved = resolveConnection(connMap, 'google-calendar', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: 'Google Calendar is not connected.' };
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
        const res = await callMatonGateway(matonApiKey, '/google-calendar/calendar/v3/calendars/primary/events', connId, 'POST', event) as { id?: string; htmlLink?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create event: ${res.error.message || JSON.stringify(res.error)}` };
        return { success: true, result: `Calendar event created: "${args.summary}" from ${args.start_time} to ${args.end_time}${res.htmlLink ? ` - ${res.htmlLink}` : ''}` };
      }

      case 'send_slack_message': {
        const connId = resolveConnection(connMap, 'slack')?.id;
        if (!connId) return { success: false, result: 'Slack is not connected.' };
        const res = await callMatonGateway(matonApiKey, '/slack/api/chat.postMessage', connId, 'POST', {
          channel: args.channel,
          text: args.text,
        }) as { ok?: boolean; error?: string; ts?: string };
        if (!res.ok) return { success: false, result: `Slack error: ${res.error || 'Unknown error'}` };
        return { success: true, result: `Message sent to ${args.channel}: "${(args.text as string).substring(0, 100)}..."` };
      }

      case 'create_notion_page': {
        const connId = resolveConnection(connMap, 'notion')?.id;
        if (!connId) return { success: false, result: 'Notion is not connected.' };
        const pageData: Record<string, unknown> = {
          parent: args.parent_page_id
            ? { page_id: args.parent_page_id }
            : { type: 'workspace', workspace: true },
          properties: { title: [{ text: { content: args.title } }] },
          children: [
            { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: args.content } }] } },
          ],
        };
        const res = await callMatonGateway(matonApiKey, '/notion/v1/pages', connId, 'POST', pageData) as { id?: string; url?: string; error?: string };
        if (res.error) return { success: false, result: `Notion error: ${res.error}` };
        return { success: true, result: `Notion page created: "${args.title}"${res.url ? ` - ${res.url}` : ''}` };
      }

      case 'create_github_issue': {
        const connId = resolveConnection(connMap, 'github')?.id;
        if (!connId) return { success: false, result: 'GitHub is not connected.' };
        const issueData: Record<string, unknown> = { title: args.title, body: args.body };
        if (args.labels) issueData.labels = (args.labels as string).split(',').map(l => l.trim());
        const res = await callMatonGateway(matonApiKey, `/github/repos/${args.owner}/${args.repo}/issues`, connId, 'POST', issueData) as { number?: number; html_url?: string; error?: string; message?: string };
        if (res.message) return { success: false, result: `GitHub error: ${res.message}` };
        return { success: true, result: `Issue #${res.number} created: "${args.title}" - ${res.html_url || ''}` };
      }

      case 'create_hubspot_contact': {
        const connId = resolveConnection(connMap, 'hubspot')?.id;
        if (!connId) return { success: false, result: 'HubSpot is not connected.' };
        const props: Record<string, string> = { email: args.email as string, firstname: args.firstname as string, lastname: args.lastname as string };
        if (args.phone) props.phone = args.phone as string;
        if (args.company) props.company = args.company as string;
        const res = await callMatonGateway(matonApiKey, '/hubspot/crm/v3/objects/contacts', connId, 'POST', { properties: props }) as { id?: string; error?: string; message?: string };
        if (res.message) return { success: false, result: `HubSpot error: ${res.message}` };
        return { success: true, result: `Contact created: ${args.firstname} ${args.lastname} (${args.email}) - ID: ${res.id}` };
      }

      case 'create_hubspot_deal': {
        const connId = resolveConnection(connMap, 'hubspot')?.id;
        if (!connId) return { success: false, result: 'HubSpot is not connected.' };
        const props: Record<string, string> = { dealname: args.dealname as string, amount: args.amount as string };
        if (args.dealstage) props.dealstage = args.dealstage as string;
        if (args.pipeline) props.pipeline = args.pipeline as string;
        const res = await callMatonGateway(matonApiKey, '/hubspot/crm/v3/objects/deals', connId, 'POST', { properties: props }) as { id?: string; message?: string };
        if (res.message) return { success: false, result: `HubSpot error: ${res.message}` };
        return { success: true, result: `Deal created: "${args.dealname}" ($${args.amount}) - ID: ${res.id}` };
      }

      case 'search_google_drive': {
        const resolved = resolveConnection(connMap, 'google-drive', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: 'Google Drive is not connected.' };
        const maxResults = (args.max_results as number) || 10;
        const q = encodeURIComponent(`name contains '${args.query}' or fullText contains '${args.query}'`);
        const data = await callMatonGateway(matonApiKey, `/google-drive/drive/v3/files?q=${q}&pageSize=${maxResults}&fields=files(id,name,mimeType,modifiedTime,webViewLink)`, connId) as { files?: { name: string; mimeType: string; modifiedTime: string; webViewLink?: string }[] };
        const files = data.files || [];
        if (!files.length) return { success: true, result: `No files found matching "${args.query}"` };
        return { success: true, result: `Found ${files.length} files:\n${files.map(f => `- ${f.name} (${f.mimeType?.split('.').pop()}) - ${f.webViewLink || ''}`).join('\n')}` };
      }

      case 'create_trello_card': {
        const connId = resolveConnection(connMap, 'trello')?.id;
        if (!connId) return { success: false, result: 'Trello is not connected.' };
        const cardData: Record<string, unknown> = { idList: args.list_id, name: args.name };
        if (args.desc) cardData.desc = args.desc;
        const res = await callMatonGateway(matonApiKey, '/trello/1/cards', connId, 'POST', cardData) as { id?: string; url?: string; error?: string };
        if (res.error) return { success: false, result: `Trello error: ${res.error}` };
        return { success: true, result: `Card created: "${args.name}" - ${res.url || ''}` };
      }

      case 'create_jira_issue': {
        const connId = resolveConnection(connMap, 'jira')?.id;
        if (!connId) return { success: false, result: 'Jira is not connected.' };
        const issueData = {
          fields: {
            project: { key: args.project_key },
            summary: args.summary,
            description: args.description || '',
            issuetype: { name: args.issue_type || 'Task' },
          },
        };
        const res = await callMatonGateway(matonApiKey, '/jira/rest/api/3/issue', connId, 'POST', issueData) as { key?: string; self?: string; errors?: unknown };
        if (res.errors) return { success: false, result: `Jira error: ${JSON.stringify(res.errors)}` };
        return { success: true, result: `Issue created: ${res.key} - "${args.summary}"` };
      }

      // ============ GoHighLevel tools ============
      case 'ghl_list_contacts': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const query = args.query ? `&query=${encodeURIComponent(args.query as string)}` : '';
        const data = await callGHL(`/contacts/?locationId=${GHL_LOCATION_ID}&limit=${limit}${query}`) as { contacts?: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string; tags?: string[] }[] };
        const contacts = data.contacts || [];
        if (!contacts.length) return { success: true, result: 'No contacts found.' };
        return { success: true, result: `Found ${contacts.length} contacts:\n${contacts.map(c => `- ${c.firstName || ''} ${c.lastName || ''} | ${c.email || 'no email'} | ${c.phone || 'no phone'} | ID: ${c.id}${c.tags?.length ? ' | Tags: ' + c.tags.join(', ') : ''}`).join('\n')}` };
      }

      case 'ghl_create_contact': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
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
        const res = await callGHL('/contacts/', 'POST', contactData) as { contact?: { id: string; firstName?: string; lastName?: string }; error?: string; message?: string };
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
        const res = await callGHL('/opportunities/', 'POST', data) as { opportunity?: { id: string; name: string }; error?: string; message?: string };
        if (res.error || res.message) return { success: false, result: `GHL error: ${res.error || res.message}` };
        return { success: true, result: `Opportunity created: "${res.opportunity?.name}" (ID: ${res.opportunity?.id})` };
      }

      case 'ghl_list_opportunities': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const data = await callGHL(`/opportunities/search?locationId=${GHL_LOCATION_ID}&pipelineId=${args.pipeline_id}&limit=${limit}`) as { opportunities?: { id: string; name: string; monetaryValue?: number; status?: string; pipelineStageId?: string; contact?: { name?: string } }[] };
        const opps = data.opportunities || [];
        if (!opps.length) return { success: true, result: 'No opportunities found in this pipeline.' };
        return { success: true, result: `Found ${opps.length} opportunities:\n${opps.map(o => `- ${o.name} | $${o.monetaryValue || 0} | Status: ${o.status || '?'} | ID: ${o.id}`).join('\n')}` };
      }

      case 'ghl_list_pipelines': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`) as { pipelines?: { id: string; name: string; stages?: { id: string; name: string }[] }[] };
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
        const res = await callGHL('/conversations/messages', 'POST', msgData) as { messageId?: string; message?: string; error?: string };
        if (res.error) return { success: false, result: `GHL message error: ${res.error}` };
        return { success: true, result: `${type} sent to contact ${args.contact_id}: "${(args.message as string).substring(0, 100)}"` };
      }

      case 'ghl_list_calendars': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/calendars/?locationId=${GHL_LOCATION_ID}`) as { calendars?: { id: string; name: string; description?: string }[] };
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
        const res = await callGHL('/calendars/events/appointments', 'POST', apptData) as { id?: string; error?: string; message?: string };
        if (res.error || res.message) return { success: false, result: `GHL appointment error: ${res.error || res.message}` };
        return { success: true, result: `Appointment booked: ${args.start_time} to ${args.end_time} (ID: ${res.id})` };
      }

      case 'ghl_add_tags': {
        const tags = (args.tags as string).split(',').map(t => t.trim());
        const res = await callGHL(`/contacts/${args.contact_id}/tags`, 'POST', { tags }) as { tags?: string[]; error?: string };
        if (res.error) return { success: false, result: `GHL tag error: ${res.error}` };
        return { success: true, result: `Tags added to contact ${args.contact_id}: ${tags.join(', ')}` };
      }

      case 'ghl_list_workflows': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/workflows/?locationId=${GHL_LOCATION_ID}`) as { workflows?: { id: string; name: string; status?: string }[] };
        const workflows = data.workflows || [];
        if (!workflows.length) return { success: true, result: 'No workflows found.' };
        return { success: true, result: `Workflows:\n${workflows.map(w => `- ${w.name} (${w.status || 'unknown'}) | ID: ${w.id}`).join('\n')}` };
      }

      case 'ghl_list_campaigns': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/campaigns/?locationId=${GHL_LOCATION_ID}`) as { campaigns?: { id: string; name: string; status?: string }[] };
        const camps = data.campaigns || [];
        if (!camps.length) return { success: true, result: 'No campaigns found.' };
        return { success: true, result: `Campaigns:\n${camps.map(c => `- ${c.name} (${c.status || 'unknown'}) | ID: ${c.id}`).join('\n')}` };
      }

      // ============ Tier 1: New GHL tool handlers ============
      case 'ghl_get_contact': {
        const data = await callGHL(`/contacts/${args.contact_id}`) as { contact?: Record<string, unknown>; error?: string };
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
        const res = await callGHL(`/contacts/${args.contact_id}`, 'PUT', updateData) as { contact?: { id: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Contact ${args.contact_id} updated successfully.` };
      }

      case 'ghl_search_contacts': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const searchBody: Record<string, unknown> = { locationId: GHL_LOCATION_ID, pageSize: (args.limit as number) || 20 };
        if (args.query) searchBody.query = args.query;
        if (args.filters) { try { Object.assign(searchBody, JSON.parse(args.filters as string)); } catch { /* ignore */ } }
        const data = await callGHL('/contacts/search', 'POST', searchBody) as { contacts?: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string }[] };
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
        const res = await callGHL(`/opportunities/${args.opportunity_id}`, 'PUT', updateData) as { opportunity?: { id: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Opportunity ${args.opportunity_id} updated successfully.` };
      }

      case 'ghl_get_calendar_events': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const startTime = (args.start_time as string) || new Date().toISOString();
        const endTime = (args.end_time as string) || new Date(Date.now() + 7 * 86400000).toISOString();
        const data = await callGHL(`/calendars/events?locationId=${GHL_LOCATION_ID}&calendarId=${args.calendar_id}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`) as { events?: { id: string; title?: string; startTime?: string; endTime?: string; contactId?: string; status?: string }[] };
        const events = data.events || [];
        if (!events.length) return { success: true, result: 'No events found in this time range.' };
        return { success: true, result: `Found ${events.length} events:\n${events.map(e => `- ${e.title || '(untitled)'} | ${e.startTime} → ${e.endTime} | Status: ${e.status || '?'} | ID: ${e.id}`).join('\n')}` };
      }

      case 'ghl_get_free_slots': {
        const startDate = (args.start_date as string) || new Date().toISOString().split('T')[0];
        const endDate = (args.end_date as string) || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        const data = await callGHL(`/calendars/${args.calendar_id}/free-slots?startDate=${startDate}&endDate=${endDate}`) as Record<string, { slots?: string[] }>;
        const allSlots: string[] = [];
        for (const [date, info] of Object.entries(data)) {
          if (info?.slots?.length) { allSlots.push(`${date}: ${info.slots.join(', ')}`); }
        }
        if (!allSlots.length) return { success: true, result: 'No free slots available in this date range.' };
        return { success: true, result: `Free slots:\n${allSlots.join('\n')}` };
      }

      case 'ghl_list_conversations': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const data = await callGHL(`/conversations/search?locationId=${GHL_LOCATION_ID}&limit=${limit}`) as { conversations?: { id: string; contactId?: string; type?: string; lastMessageDate?: string; fullName?: string }[] };
        const convos = data.conversations || [];
        if (!convos.length) return { success: true, result: 'No conversations found.' };
        return { success: true, result: `Found ${convos.length} conversations:\n${convos.map(c => `- ${c.fullName || 'Unknown'} | Type: ${c.type || '?'} | Last: ${c.lastMessageDate || '?'} | ID: ${c.id}`).join('\n')}` };
      }

      case 'ghl_get_conversation_messages': {
        const data = await callGHL(`/conversations/${args.conversation_id}/messages`) as { messages?: { id: string; body?: string; type?: string; direction?: string; dateAdded?: string }[] };
        const msgs = data.messages || [];
        if (!msgs.length) return { success: true, result: 'No messages in this conversation.' };
        return { success: true, result: `Messages (${msgs.length}):\n${msgs.slice(0, 30).map(m => `- [${m.direction || '?'}] ${m.body?.substring(0, 200) || '(empty)'} (${m.dateAdded || ''})`).join('\n')}` };
      }

      case 'ghl_list_invoices': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const data = await callGHL(`/invoices/?altId=${GHL_LOCATION_ID}&altType=location&limit=${limit}`) as { invoices?: { _id: string; name?: string; total?: number; status?: string; createdAt?: string }[] };
        const invoices = data.invoices || [];
        if (!invoices.length) return { success: true, result: 'No invoices found.' };
        return { success: true, result: `Invoices (${invoices.length}):\n${invoices.map(i => `- ${i.name || 'Untitled'} | $${i.total || 0} | ${i.status || '?'} | ID: ${i._id}`).join('\n')}` };
      }

      case 'ghl_create_invoice': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const invoiceData: Record<string, unknown> = { altId: GHL_LOCATION_ID, altType: 'location', name: args.name, contactId: args.contact_id };
        if (args.items) { try { invoiceData.items = JSON.parse(args.items as string); } catch { /* ignore */ } }
        const res = await callGHL('/invoices/', 'POST', invoiceData) as { invoice?: { _id: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Invoice created: "${args.name}" (ID: ${res.invoice?._id})` };
      }

      case 'ghl_list_orders': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&limit=${(args.limit as number) || 20}`) as { data?: { id: string; name?: string; amount?: number; status?: string }[] };
        const orders = data.data || [];
        if (!orders.length) return { success: true, result: 'No orders found.' };
        return { success: true, result: `Orders (${orders.length}):\n${orders.map(o => `- ${o.name || 'Order'} | $${o.amount || 0} | ${o.status || '?'} | ID: ${o.id}`).join('\n')}` };
      }

      case 'ghl_list_transactions': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/payments/transactions?altId=${GHL_LOCATION_ID}&altType=location&limit=${(args.limit as number) || 20}`) as { data?: { id: string; amount?: number; status?: string; createdAt?: string }[] };
        const txns = data.data || [];
        if (!txns.length) return { success: true, result: 'No transactions found.' };
        return { success: true, result: `Transactions (${txns.length}):\n${txns.map(t => `- $${t.amount || 0} | ${t.status || '?'} | ${t.createdAt || ''} | ID: ${t.id}`).join('\n')}` };
      }

      case 'ghl_list_forms': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/forms/?locationId=${GHL_LOCATION_ID}`) as { forms?: { id: string; name: string }[] };
        const forms = data.forms || [];
        if (!forms.length) return { success: true, result: 'No forms found.' };
        return { success: true, result: `Forms:\n${forms.map(f => `- ${f.name} | ID: ${f.id}`).join('\n')}` };
      }

      case 'ghl_get_form_submissions': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const limit = (args.limit as number) || 20;
        const data = await callGHL(`/forms/submissions?locationId=${GHL_LOCATION_ID}&formId=${args.form_id}&limit=${limit}`) as { submissions?: { id: string; contactId?: string; createdAt?: string; data?: Record<string, string> }[] };
        const subs = data.submissions || [];
        if (!subs.length) return { success: true, result: 'No submissions found for this form.' };
        return { success: true, result: `Submissions (${subs.length}):\n${subs.map(s => `- Contact: ${s.contactId || '?'} | ${s.createdAt || ''} | Data: ${JSON.stringify(s.data || {}).substring(0, 200)}`).join('\n')}` };
      }

      case 'ghl_list_funnels': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/funnels/funnel/list?locationId=${GHL_LOCATION_ID}`) as { funnels?: { id: string; name: string; steps?: number }[] };
        const funnels = data.funnels || [];
        if (!funnels.length) return { success: true, result: 'No funnels found.' };
        return { success: true, result: `Funnels:\n${funnels.map(f => `- ${f.name} | ID: ${f.id}`).join('\n')}` };
      }

      case 'ghl_list_custom_fields': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/locations/${GHL_LOCATION_ID}/customFields`) as { customFields?: { id: string; name: string; fieldKey?: string; dataType?: string }[] };
        const fields = data.customFields || [];
        if (!fields.length) return { success: true, result: 'No custom fields found.' };
        return { success: true, result: `Custom Fields:\n${fields.map(f => `- ${f.name} (${f.dataType || '?'}) | Key: ${f.fieldKey || f.id}`).join('\n')}` };
      }

      case 'ghl_list_custom_values': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/locations/${GHL_LOCATION_ID}/customValues`) as { customValues?: { id: string; name: string; value?: string }[] };
        const values = data.customValues || [];
        if (!values.length) return { success: true, result: 'No custom values found.' };
        return { success: true, result: `Custom Values:\n${values.map(v => `- ${v.name}: ${v.value || '(empty)'} | ID: ${v.id}`).join('\n')}` };
      }

      case 'ghl_list_users': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/users/?locationId=${GHL_LOCATION_ID}`) as { users?: { id: string; name?: string; email?: string; role?: string }[] };
        const users = data.users || [];
        if (!users.length) return { success: true, result: 'No users found.' };
        return { success: true, result: `Users:\n${users.map(u => `- ${u.name || 'Unknown'} | ${u.email || ''} | ${u.role || '?'} | ID: ${u.id}`).join('\n')}` };
      }

      case 'ghl_list_tags': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/locations/${GHL_LOCATION_ID}/tags`) as { tags?: { id: string; name: string }[] };
        const tags = data.tags || [];
        if (!tags.length) return { success: true, result: 'No tags found.' };
        return { success: true, result: `Tags:\n${tags.map(t => `- ${t.name} | ID: ${t.id}`).join('\n')}` };
      }

      // ============ Tier 2: New GHL action handlers ============
      case 'ghl_delete_contact': {
        const res = await callGHL(`/contacts/${args.contact_id}`, 'DELETE') as { succeded?: boolean; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Contact ${args.contact_id} deleted.` };
      }

      case 'ghl_add_contact_note': {
        const res = await callGHL(`/contacts/${args.contact_id}/notes`, 'POST', { body: args.body }) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Note added to contact ${args.contact_id}.` };
      }

      case 'ghl_list_contact_notes': {
        const data = await callGHL(`/contacts/${args.contact_id}/notes`) as { notes?: { id: string; body?: string; dateAdded?: string }[] };
        const notes = data.notes || [];
        if (!notes.length) return { success: true, result: 'No notes found for this contact.' };
        return { success: true, result: `Notes (${notes.length}):\n${notes.map(n => `- ${n.body?.substring(0, 200) || '(empty)'} (${n.dateAdded || ''})`).join('\n')}` };
      }

      case 'ghl_add_contact_task': {
        const taskData: Record<string, unknown> = { title: args.title };
        if (args.body) taskData.body = args.body;
        if (args.dueDate) taskData.dueDate = args.dueDate;
        const res = await callGHL(`/contacts/${args.contact_id}/tasks`, 'POST', taskData) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Task "${args.title}" added to contact ${args.contact_id}.` };
      }

      case 'ghl_list_contact_tasks': {
        const data = await callGHL(`/contacts/${args.contact_id}/tasks`) as { tasks?: { id: string; title?: string; body?: string; completed?: boolean; dueDate?: string }[] };
        const tasks = data.tasks || [];
        if (!tasks.length) return { success: true, result: 'No tasks found for this contact.' };
        return { success: true, result: `Tasks (${tasks.length}):\n${tasks.map(t => `- ${t.completed ? '✅' : '⬜'} ${t.title || '(untitled)'} | Due: ${t.dueDate || 'N/A'} | ID: ${t.id}`).join('\n')}` };
      }

      case 'ghl_remove_tags': {
        const tags = (args.tags as string).split(',').map(t => t.trim());
        const res = await callGHL(`/contacts/${args.contact_id}/tags`, 'DELETE', { tags }) as { tags?: string[]; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Tags removed from contact ${args.contact_id}: ${tags.join(', ')}` };
      }

      case 'ghl_cancel_appointment': {
        const res = await callGHL(`/calendars/events/appointments/${args.event_id}`, 'DELETE') as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Appointment ${args.event_id} cancelled.` };
      }

      case 'ghl_trigger_workflow': {
        const res = await callGHL(`/contacts/${args.contact_id}/workflow/${args.workflow_id}`, 'POST') as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Workflow ${args.workflow_id} triggered for contact ${args.contact_id}.` };
      }

      // ============ Google Docs tools ============
      case 'create_google_doc': {
        const resolved = resolveConnection(connMap, 'google-drive', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: 'Google Drive is not connected (needed for Docs).' };
        const fileMetadata = { name: args.title, mimeType: 'application/vnd.google-apps.document' };
        const res = await callMatonGateway(matonApiKey, '/google-drive/drive/v3/files?fields=id,name,webViewLink', connId, 'POST', fileMetadata) as { id?: string; name?: string; webViewLink?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create doc: ${res.error.message || JSON.stringify(res.error)}` };
        const link = res.webViewLink || `https://docs.google.com/document/d/${res.id}/edit`;
        let result = `Google Doc created: "${args.title}" — ${link}`;
        if (args.content) {
          try {
            const docConnId = resolveConnection(connMap, 'google-docs', accountHint, userMessage, aliasMap)?.id || connId;
            await callMatonGateway(matonApiKey, `/google-docs/v1/documents/${res.id}:batchUpdate`, docConnId, 'POST', {
              requests: [{ insertText: { location: { index: 1 }, text: args.content as string } }],
            });
            result += '\nContent added successfully.';
          } catch { result += '\nDoc created but could not insert content (Docs API may not be connected).'; }
        }
        return { success: true, result };
      }

      // ============ Google Sheets tools ============
      case 'create_google_sheet': {
        const resolved = resolveConnection(connMap, 'google-drive', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: 'Google Drive is not connected (needed for Sheets).' };
        const fileMetadata = { name: args.title, mimeType: 'application/vnd.google-apps.spreadsheet' };
        const res = await callMatonGateway(matonApiKey, '/google-drive/drive/v3/files?fields=id,name,webViewLink', connId, 'POST', fileMetadata) as { id?: string; name?: string; webViewLink?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create sheet: ${res.error.message || JSON.stringify(res.error)}` };
        const link = res.webViewLink || `https://docs.google.com/spreadsheets/d/${res.id}/edit`;
        return { success: true, result: `Google Sheet created: "${args.title}" — ${link}` };
      }

      case 'read_sheet_data': {
        const connId = resolveConnection(connMap, 'google-sheets', accountHint, userMessage)?.id || resolveConnection(connMap, 'google-drive', accountHint, userMessage, aliasMap)?.id;
        if (!connId) return { success: false, result: 'Google Sheets is not connected.' };
        const range = encodeURIComponent((args.range as string) || 'Sheet1');
        const data = await callMatonGateway(matonApiKey, `/google-sheets/v4/spreadsheets/${args.spreadsheet_id}/values/${range}`, connId) as { values?: string[][]; error?: { message?: string } };
        if (data.error) return { success: false, result: `Failed to read sheet: ${data.error.message}` };
        const rows = data.values || [];
        if (!rows.length) return { success: true, result: 'Sheet is empty or range has no data.' };
        return { success: true, result: `Read ${rows.length} rows:\n${rows.slice(0, 50).map(r => r.join(' | ')).join('\n')}${rows.length > 50 ? `\n... and ${rows.length - 50} more rows` : ''}` };
      }

      case 'append_sheet_rows': {
        const connId = resolveConnection(connMap, 'google-sheets', accountHint, userMessage)?.id || resolveConnection(connMap, 'google-drive', accountHint, userMessage, aliasMap)?.id;
        if (!connId) return { success: false, result: 'Google Sheets is not connected.' };
        const range = encodeURIComponent((args.range as string) || 'Sheet1');
        let values: string[][];
        try { values = JSON.parse(args.values as string); } catch { return { success: false, result: 'Invalid values format. Must be a JSON array of arrays.' }; }
        const res = await callMatonGateway(matonApiKey, `/google-sheets/v4/spreadsheets/${args.spreadsheet_id}/values/${range}:append?valueInputOption=USER_ENTERED`, connId, 'POST', { values }) as { updates?: { updatedRows?: number }; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to append: ${res.error.message}` };
        return { success: true, result: `Appended ${res.updates?.updatedRows || values.length} rows to the spreadsheet.` };
      }

      // ============ Google Slides tools ============
      case 'create_google_presentation': {
        const resolved = resolveConnection(connMap, 'google-drive', accountHint, userMessage, aliasMap);
        const connId = resolved?.id;
        if (!connId) return { success: false, result: 'Google Drive is not connected (needed for Slides).' };
        const fileMetadata = { name: args.title, mimeType: 'application/vnd.google-apps.presentation' };
        const res = await callMatonGateway(matonApiKey, '/google-drive/drive/v3/files?fields=id,name,webViewLink', connId, 'POST', fileMetadata) as { id?: string; name?: string; webViewLink?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create presentation: ${res.error.message || JSON.stringify(res.error)}` };
        const link = res.webViewLink || `https://docs.google.com/presentation/d/${res.id}/edit`;
        return { success: true, result: `Google Slides presentation created: "${args.title}" — ${link}` };
      }

      // ============ ClickUp tools ============
      case 'create_clickup_task': {
        const connId = resolveConnection(connMap, 'clickup')?.id;
        if (!connId) return { success: false, result: 'ClickUp is not connected.' };
        const taskData: Record<string, unknown> = { name: args.name };
        if (args.description) taskData.description = args.description;
        if (args.priority) taskData.priority = args.priority;
        const res = await callMatonGateway(matonApiKey, `/clickup/api/v2/list/${args.list_id}/task`, connId, 'POST', taskData) as { id?: string; name?: string; url?: string; err?: string };
        if (res.err) return { success: false, result: `ClickUp error: ${res.err}` };
        return { success: true, result: `Task created: "${args.name}" — ${res.url || `https://app.clickup.com/t/${res.id}`}` };
      }

      case 'list_clickup_tasks': {
        const connId = resolveConnection(connMap, 'clickup')?.id;
        if (!connId) return { success: false, result: 'ClickUp is not connected.' };
        const data = await callMatonGateway(matonApiKey, `/clickup/api/v2/list/${args.list_id}/task?page=0`, connId) as { tasks?: { id: string; name: string; status?: { status?: string }; url?: string; priority?: { priority?: string } }[] };
        const tasks = data.tasks || [];
        if (!tasks.length) return { success: true, result: 'No tasks in this list.' };
        return { success: true, result: `Found ${tasks.length} tasks:\n${tasks.map(t => `- ${t.name} (${t.status?.status || '?'}) — ${t.url || `https://app.clickup.com/t/${t.id}`}`).join('\n')}` };
      }

      // ============ Tier 3: GHL Social, Products, Courses, Surveys, Blogs, Media, Companies, Links, Businesses ============
      case 'ghl_list_social_accounts': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/accounts`) as { accounts?: { id: string; name?: string; type?: string; platform?: string }[] };
        const accounts = (data as unknown as { id: string; name?: string; type?: string; platform?: string }[]) || [];
        const list = Array.isArray(data) ? data : (data.accounts || []);
        if (!list.length) return { success: true, result: 'No social accounts connected.' };
        return { success: true, result: `Social accounts:\n${list.map((a: Record<string, unknown>) => `- ${a.name || a.platform || '?'} (${a.type || a.platform || '?'}) | ID: ${a.id}`).join('\n')}` };
      }

      case 'ghl_list_social_posts': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/posts`) as { posts?: { id: string; status?: string; summary?: string; scheduledAt?: string }[] };
        const posts = data.posts || (Array.isArray(data) ? data : []);
        if (!posts.length) return { success: true, result: 'No social posts found.' };
        return { success: true, result: `Social posts (${posts.length}):\n${(posts as Record<string, unknown>[]).slice(0, 20).map((p) => `- ${(p.summary as string)?.substring(0, 100) || '(no text)'} | Status: ${p.status || '?'} | ID: ${p.id}`).join('\n')}` };
      }

      case 'ghl_create_social_post': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const postData: Record<string, unknown> = { summary: args.post_text };
        if (args.account_ids) postData.accountIds = (args.account_ids as string).split(',').map(s => s.trim());
        if (args.scheduled_at) postData.scheduledAt = args.scheduled_at;
        if (args.media_urls) postData.media = (args.media_urls as string).split(',').map(url => ({ url: url.trim() }));
        const res = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/posts`, 'POST', postData) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Social post created${args.scheduled_at ? ' (scheduled)' : ''} (ID: ${res.id || 'created'})` };
      }

      case 'ghl_delete_social_post': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL(`/social-media-posting/${GHL_LOCATION_ID}/posts/${args.post_id}`, 'DELETE') as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Social post ${args.post_id} deleted.` };
      }

      case 'ghl_list_products': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/products/?locationId=${GHL_LOCATION_ID}&limit=${(args.limit as number) || 20}`) as { products?: { id: string; name?: string; price?: number; currency?: string }[] };
        const products = data.products || [];
        if (!products.length) return { success: true, result: 'No products found.' };
        return { success: true, result: `Products (${products.length}):\n${products.map(p => `- ${p.name || 'Untitled'} | $${((p.price || 0) / 100).toFixed(2)} | ID: ${p.id}`).join('\n')}` };
      }

      case 'ghl_get_product': {
        const data = await callGHL(`/products/${args.product_id}`) as { id?: string; name?: string; description?: string; price?: number; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Product: ${data.name || '?'}\nDescription: ${data.description || 'N/A'}\nPrice: $${((data.price || 0) / 100).toFixed(2)}\nID: ${data.id}` };
      }

      case 'ghl_create_product': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const productData: Record<string, unknown> = { locationId: GHL_LOCATION_ID, name: args.name };
        if (args.description) productData.description = args.description;
        if (args.price) productData.price = args.price;
        const res = await callGHL('/products/', 'POST', productData) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Product created: "${args.name}" (ID: ${res.id || 'created'})` };
      }

      case 'ghl_update_product': {
        const updateData: Record<string, unknown> = {};
        if (args.name) updateData.name = args.name;
        if (args.description) updateData.description = args.description;
        if (args.price) updateData.price = args.price;
        const res = await callGHL(`/products/${args.product_id}`, 'PUT', updateData) as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Product ${args.product_id} updated.` };
      }

      case 'ghl_delete_product': {
        const res = await callGHL(`/products/${args.product_id}`, 'DELETE') as { error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Product ${args.product_id} deleted.` };
      }

      case 'ghl_list_courses': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/courses/?locationId=${GHL_LOCATION_ID}`) as { courses?: { id: string; title?: string; status?: string }[] };
        const courses = data.courses || [];
        if (!courses.length) return { success: true, result: 'No courses found.' };
        return { success: true, result: `Courses:\n${courses.map(c => `- ${c.title || 'Untitled'} | Status: ${c.status || '?'} | ID: ${c.id}`).join('\n')}` };
      }

      case 'ghl_list_surveys': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/surveys/?locationId=${GHL_LOCATION_ID}`) as { surveys?: { id: string; name: string }[] };
        const surveys = data.surveys || [];
        if (!surveys.length) return { success: true, result: 'No surveys found.' };
        return { success: true, result: `Surveys:\n${surveys.map(s => `- ${s.name} | ID: ${s.id}`).join('\n')}` };
      }

      case 'ghl_get_survey_submissions': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/surveys/submissions?locationId=${GHL_LOCATION_ID}&surveyId=${args.survey_id}&limit=${(args.limit as number) || 20}`) as { submissions?: { id: string; contactId?: string; createdAt?: string; data?: Record<string, string> }[] };
        const subs = data.submissions || [];
        if (!subs.length) return { success: true, result: 'No survey submissions found.' };
        return { success: true, result: `Survey submissions (${subs.length}):\n${subs.map(s => `- Contact: ${s.contactId || '?'} | ${s.createdAt || ''} | Data: ${JSON.stringify(s.data || {}).substring(0, 200)}`).join('\n')}` };
      }

      case 'ghl_list_blog_posts': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/blogs/posts?locationId=${GHL_LOCATION_ID}&limit=${(args.limit as number) || 20}`) as { posts?: { id: string; title?: string; status?: string; createdAt?: string }[] };
        const posts = data.posts || [];
        if (!posts.length) return { success: true, result: 'No blog posts found.' };
        return { success: true, result: `Blog posts (${posts.length}):\n${posts.map(p => `- ${p.title || 'Untitled'} | ${p.status || '?'} | ${p.createdAt || ''} | ID: ${p.id}`).join('\n')}` };
      }

      case 'ghl_get_blog_post': {
        const data = await callGHL(`/blogs/posts/${args.post_id}`) as { id?: string; title?: string; content?: string; status?: string; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Blog post: ${data.title || '?'}\nStatus: ${data.status || '?'}\nContent preview: ${(data.content || '').substring(0, 500)}\nID: ${data.id}` };
      }

      case 'ghl_create_blog_post': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const postData: Record<string, unknown> = { locationId: GHL_LOCATION_ID, title: args.title, content: args.content, status: (args.status as string) || 'draft' };
        const res = await callGHL('/blogs/posts', 'POST', postData) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Blog post created: "${args.title}" (${(args.status as string) || 'draft'}) (ID: ${res.id || 'created'})` };
      }

      case 'ghl_list_media_files': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/medias/files?altId=${GHL_LOCATION_ID}&altType=location&limit=${(args.limit as number) || 50}`) as { files?: { id: string; name?: string; url?: string; type?: string }[] };
        const files = data.files || [];
        if (!files.length) return { success: true, result: 'No media files found.' };
        return { success: true, result: `Media files (${files.length}):\n${files.slice(0, 30).map(f => `- ${f.name || 'Untitled'} (${f.type || '?'}) | ID: ${f.id}`).join('\n')}` };
      }

      case 'ghl_list_companies': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/companies/?locationId=${GHL_LOCATION_ID}&limit=${(args.limit as number) || 20}`) as { companies?: { id: string; name?: string; email?: string; phone?: string }[] };
        const companies = data.companies || [];
        if (!companies.length) return { success: true, result: 'No companies found.' };
        return { success: true, result: `Companies (${companies.length}):\n${companies.map(c => `- ${c.name || '?'} | ${c.email || ''} | ${c.phone || ''} | ID: ${c.id}`).join('\n')}` };
      }

      case 'ghl_get_company': {
        const data = await callGHL(`/companies/${args.company_id}`) as { id?: string; name?: string; email?: string; phone?: string; website?: string; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Company: ${data.name || '?'}\nEmail: ${data.email || 'N/A'}\nPhone: ${data.phone || 'N/A'}\nWebsite: ${data.website || 'N/A'}\nID: ${data.id}` };
      }

      case 'ghl_list_links': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/links/?locationId=${GHL_LOCATION_ID}`) as { links?: { id: string; name?: string; url?: string; clicks?: number }[] };
        const links = data.links || [];
        if (!links.length) return { success: true, result: 'No links found.' };
        return { success: true, result: `Links:\n${links.map(l => `- ${l.name || '?'} | ${l.url || ''} | Clicks: ${l.clicks || 0} | ID: ${l.id}`).join('\n')}` };
      }

      case 'ghl_create_link': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const res = await callGHL('/links/', 'POST', { locationId: GHL_LOCATION_ID, name: args.name, redirectTo: args.redirectTo }) as { id?: string; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Link created: "${args.name}" → ${args.redirectTo} (ID: ${res.id || 'created'})` };
      }

      case 'ghl_list_businesses': {
        const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
        if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
        const data = await callGHL(`/businesses/?locationId=${GHL_LOCATION_ID}`) as { businesses?: { id: string; name?: string; email?: string; phone?: string }[] };
        const businesses = data.businesses || [];
        if (!businesses.length) return { success: true, result: 'No businesses found.' };
        return { success: true, result: `Businesses:\n${businesses.map(b => `- ${b.name || '?'} | ${b.email || ''} | ${b.phone || ''} | ID: ${b.id}`).join('\n')}` };
      }

      case 'ghl_get_business': {
        const data = await callGHL(`/businesses/${args.business_id}`) as { id?: string; name?: string; email?: string; phone?: string; website?: string; error?: string };
        if (data.error) return { success: false, result: `GHL error: ${data.error}` };
        return { success: true, result: `Business: ${data.name || '?'}\nEmail: ${data.email || 'N/A'}\nPhone: ${data.phone || 'N/A'}\nWebsite: ${data.website || 'N/A'}\nID: ${data.id}` };
      }

      // ============ GSC / SEO Intelligence tool handlers ============
      case 'gsc_list_sites': {
        const connId = resolveConnection(connMap, 'google-search-console', undefined, userMessage, aliasMap)?.id;
        if (!connId) return { success: false, result: 'Google Search Console is not connected.' };
        const data = await callMatonGateway(matonApiKey, '/google-search-console/webmasters/v3/sites', connId) as { siteEntry?: { siteUrl: string; permissionLevel?: string }[] };
        const sites = data.siteEntry || [];
        if (!sites.length) return { success: true, result: 'No sites found in Google Search Console.' };
        return { success: true, result: `GSC Properties (${sites.length}):\n${sites.map(s => `- ${s.siteUrl} (${s.permissionLevel || 'unknown permission'})`).join('\n')}` };
      }

      case 'gsc_query': {
        const connId = resolveConnection(connMap, 'google-search-console', undefined, userMessage, aliasMap)?.id;
        if (!connId) return { success: false, result: 'Google Search Console is not connected.' };
        const dims = (args.dimensions as string || 'query').split(',').map(d => d.trim());
        const rowLimit = Math.min((args.row_limit as number) || 100, 1000);
        const body: Record<string, unknown> = {
          startDate: args.start_date,
          endDate: args.end_date,
          dimensions: dims,
          rowLimit,
        };
        if (args.aggregation_type) body.aggregationType = args.aggregation_type;
        if (args.filters) { try { body.dimensionFilterGroups = [{ filters: JSON.parse(args.filters as string) }]; } catch { /* ignore bad filter JSON */ } }
        const data = await callMatonGateway(matonApiKey, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(args.site_url as string)}/searchAnalytics/query`, connId, 'POST', body) as { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] };
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

      case 'web_search_google': {
        try {
          const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
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
              max_tokens: 2000,
            }),
          });
          if (!searchRes.ok) return { success: false, result: `Search failed: HTTP ${searchRes.status}` };
          const searchData = await searchRes.json();
          const content = searchData.choices?.[0]?.message?.content || '';
          return { success: true, result: `**Live Google SERP Results for "${keyword}":**\n\n${content}\n\nCross-reference these positions with GSC data to validate ranking accuracy.` };
        } catch (e) { return { success: false, result: `Search error: ${e instanceof Error ? e.message : 'Unknown'}` }; }
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
          return { success: false, result: `Memory save error: ${e instanceof Error ? e.message : 'Unknown'}` };
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
            taskRowId = taskRow?.id || null;
          }

          // Step 1: Tavily search
          console.log(`[deep_research] Searching: "${query}" (depth: ${searchDepth}, max: ${maxResults})`);
          const tavilyRes = await fetch('https://api.tavily.com/search', {
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

          if (!tavilyRes.ok) {
            const errText = await tavilyRes.text();
            console.error('[deep_research] Tavily error:', errText);
            if (adminClient && taskRowId) {
              await adminClient.from('research_tasks').update({ status: 'failed' }).eq('id', taskRowId);
            }
            return { success: false, result: `Research search failed: ${tavilyRes.status}` };
          }

          const tavilyData = await tavilyRes.json();
          const results = tavilyData.results || [];
          const tavilyAnswer = tavilyData.answer || '';
          console.log(`[deep_research] Found ${results.length} sources`);

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
              model: 'gpt-4.1-2025-04-14',
              messages: [
                { role: 'system', content: 'You are a thorough research analyst. Produce well-structured, citation-rich reports.' },
                { role: 'user', content: synthesisPrompt },
              ],
              max_tokens: 4096,
            }),
          });

          if (!synthRes.ok) {
            console.error('[deep_research] Synthesis error:', await synthRes.text());
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

          const adminClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          );

          // Fetch existing task
          const { data: existing, error: fetchErr } = await adminClient
            .from('work_tasks')
            .select('*')
            .eq('id', taskId)
            .single();

          if (fetchErr || !existing) {
            return { success: false, result: `Task not found: ${fetchErr?.message || 'no rows'}` };
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
            .eq('id', taskId);

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

IMPORTANT TOOL USAGE RULES:
1. When the user asks you to DO something (send, create, schedule, post, etc.), USE THE APPROPRIATE TOOL.
2. Always confirm the action with the user BEFORE executing destructive or important actions.
3. If a service is not connected, tell the user to connect it in Settings > Maton AI Integrations.
4. For drafts vs sends: default to DRAFTS for emails unless the user explicitly says "send".
5. For email deletion: ALWAYS use trash (recoverable). Never use permanent HTTP DELETE on messages — it will fail with a permissions error.

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
- Use simple language. Be informative and explain key points.
- Use basic markdown (headings, bullets, bold). No tables or HTML.
- Clean, readable, scannable on a phone.
- No emojis. No "As an AI..." disclaimers.

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
4. update_work_task → status: "up_for_review", draft_output: <result>, ai_status: "completed", next_action: "needs_review", activity_entry: { action: "work_completed", detail: "...", actor: "ai", status: "completed" }
5. On failure → ai_status: "failed", next_action: "waiting_on_human", activity_entry with status: "failed"

IMPORTANT: Always reuse the task_id returned from create_work_task for all update_work_task calls in the same flow.

STATE TRANSITIONS — always follow this order, never skip stages:
  todo → in_progress → up_for_review → completed
  up_for_review can go back to in_progress (rework)
  completed can go back to in_progress (reopen)

SMART DEFAULT MAPPINGS:
- Research requests → task_type: "research", intent_type: "ops"
- Content drafts → task_type: "content", intent_type: "marketing"
- Email drafts → task_type: "email", intent_type: "ops" (or "sales_support" if sales-related)
- Client work/planning → intent_type: "fulfillment"
- Marketing campaigns → intent_type: "marketing" (NOT "content")
- Ops/system setup → intent_type: "ops"

Default assigned_to is 'ai'. Default next_action is 'waiting_on_ai'.

You are the intelligence, memory, and action layer of ${osName}.`;
};

// ============================================================================
// DETERMINE WHICH TOOLS ARE AVAILABLE BASED ON CONNECTIONS
// ============================================================================

function getAvailableTools(connMap: MultiConnMap): ToolDef[] {
  const GHL_API_KEY = Deno.env.get('GHL_API_KEY');
  const hasGHL = !!GHL_API_KEY;

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
    'send_slack_message': 'slack',
    'create_notion_page': 'notion',
    'create_github_issue': 'github',
    'create_hubspot_contact': 'hubspot',
    'create_hubspot_deal': 'hubspot',
    'search_google_drive': 'google-drive',
    'create_google_doc': 'google-drive',
    'create_google_sheet': 'google-drive',
    'read_sheet_data': 'google-drive',
    'append_sheet_rows': 'google-drive',
    'create_google_presentation': 'google-drive',
    'create_clickup_task': 'clickup',
    'list_clickup_tasks': 'clickup',
    'create_trello_card': 'trello',
    'create_jira_issue': 'jira',
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
    'ghl_list_blog_posts': 'ghl',
    'ghl_get_blog_post': 'ghl',
    'ghl_create_blog_post': 'ghl',
    'ghl_list_media_files': 'ghl',
    'ghl_list_companies': 'ghl',
    'ghl_get_company': 'ghl',
    'ghl_list_links': 'ghl',
    'ghl_create_link': 'ghl',
    'ghl_list_businesses': 'ghl',
    'ghl_get_business': 'ghl',
    // GSC / SEO tools
    'gsc_list_sites': 'google-search-console',
    'gsc_query': 'google-search-console',
    'gsc_save_snapshot': 'google-search-console',
    'gsc_compare_snapshots': 'google-search-console',
    'web_search_google': '_always_',
    'save_memory': '_always_',
    'deep_research': '_always_',
    'create_work_task': '_always_',
    'update_work_task': '_always_',
  };

  return MATON_ACTION_TOOLS.filter(tool => {
    const requiredService = toolToService[tool.function.name];
    if (requiredService === 'ghl') return hasGHL;
    if (requiredService === '_always_') return true;
    return requiredService ? connMap.has(requiredService) : true;
  });
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
  'send_slack_message': 'Sending Slack message',
  'create_notion_page': 'Creating Notion page',
  'create_github_issue': 'Creating GitHub issue',
  'search_google_drive': 'Searching Google Drive',
  'create_google_doc': 'Creating Google Doc',
  'create_google_sheet': 'Creating Google Sheet',
  'ghl_list_contacts': 'Listing GHL contacts',
  'ghl_create_contact': 'Creating GHL contact',
  'ghl_send_message': 'Sending GHL message',
  'gsc_list_sites': 'Listing GSC sites',
  'gsc_query': 'Querying Search Console',
  'gsc_save_snapshot': 'Saving SEO snapshot',
  'gsc_compare_snapshots': 'Loading SEO snapshots',
  'web_search_google': 'Searching Google',
  'save_memory': 'Saving to memory',
  'deep_research': 'Researching the web',
  'create_work_task': 'Creating work task',
  'update_work_task': 'Updating work task',
};

function inferTaskTitle(toolNames: string[]): string {
  if (toolNames.some(n => n.includes('trash') || n.includes('label') || n === 'list_emails')) return 'Managing emails';
  if (toolNames.some(n => n.includes('email') || n.includes('mail'))) return 'Handling email';
  if (toolNames.some(n => n.includes('calendar'))) return 'Managing calendar';
  if (toolNames.some(n => n.includes('slack'))) return 'Messaging on Slack';
  if (toolNames.some(n => n.startsWith('ghl_'))) return 'Working in GoHighLevel';
  if (toolNames.some(n => n.includes('notion'))) return 'Working in Notion';
  if (toolNames.some(n => n.includes('github'))) return 'Working on GitHub';
  if (toolNames.some(n => n.includes('google'))) return 'Working in Google';
  return 'Executing task';
}

async function runToolLoop(
  modelConfig: ModelConfig,
  apiKey: string,
  openAIMessages: { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[],
  tools: ToolDef[],
  matonApiKey: string,
  connMap: MultiConnMap,
  maxIterations = 10,
  onTaskUpdate?: (event: TaskUpdateEvent) => void | Promise<void>,
  userMessage?: string,
  aliasMap?: AliasEntry[],
  userId?: string | null,
): Promise<{ role: string; content: string }> {
  let iteration = 0;
  const taskId = crypto.randomUUID();
  let taskCreated = false;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`Tool loop iteration ${iteration}`);

    const response = await fetch(modelConfig.apiEndpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelConfig.name,
        messages: openAIMessages,
        max_completion_tokens: modelConfig.maxTokens,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`OpenAI error in tool loop: ${response.status}`, errText);
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from AI');

    const msg = choice.message;
    openAIMessages.push(msg);

    // If the model wants to call tools
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const toolNames = msg.tool_calls.map((tc: { function: { name: string } }) => tc.function.name);
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
          // Inject user ID for save_memory and deep_research tools
          if ((tc.function.name === 'save_memory' || tc.function.name === 'deep_research') && userId) {
            args.__user_id = userId;
          }
          const stepLabel = TOOL_DISPLAY_NAMES[tc.function.name] || tc.function.name;
          if (onTaskUpdate) await onTaskUpdate({ taskId, title: '', step: stepLabel, status: 'in_progress' });

          console.log(`Executing tool: ${tc.function.name}`, args);
          const result = await executeToolCall(tc.function.name, args, matonApiKey, connMap, userMessage, aliasMap);
          console.log(`Tool result (${tc.function.name}):`, result.success ? 'SUCCESS' : 'FAILED', result.result.substring(0, 200));

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
      // Continue the loop so the model can process tool results
      continue;
    }

    // No tool calls - return the final response
    if (taskCreated && onTaskUpdate) {
      // Extract a short summary from the AI's final response for the task bubble
      const summary = (msg.content || '').substring(0, 200);
      await onTaskUpdate({ taskId, title: '', step: 'Complete', status: 'done', summary });
    }
    return { role: 'assistant', content: msg.content || '' };
  }

  return { role: 'assistant', content: 'I tried to complete the action but hit the maximum number of steps. Please try again with a simpler request.' };
}

// ============================================================================
// INFINITY ROUTER — Intelligent Pre-processing Layer
// ============================================================================

interface InfinityClassification {
  intent: string;
  input_length: number;
  needs_memory: boolean;
  needs_deep_reasoning: boolean;
  needs_multimodal: boolean;
  needs_live_data: boolean;
  confidence: number;
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

function classifyMessage(messages: { role: string; content: string }[]): InfinityClassification {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const text = lastUser?.content || '';
  const lower = text.toLowerCase();
  const len = text.length;

  const memoryKw = ['remember', 'recall', 'last time', 'you said', 'we discussed', 'previously', 'my preference', 'i told you', 'you know that'];
  const analysisKw = ['analyze', 'analysis', 'compare', 'synthesize', 'summarize a long', 'deep dive', 'explain in detail', 'break down', 'evaluate', 'assess', 'review this', 'what do you think about'];
  const multimodalKw = ['image', 'photo', 'screenshot', 'picture', 'file', 'pdf', 'document', 'attachment'];
  const actionKw = ['send', 'create', 'schedule', 'book', 'post', 'draft', 'compose'];
  const liveDataKw = ['weather', 'stock', 'price', 'news', 'current', 'today\'s', 'latest'];

  return {
    intent: analysisKw.some(k => lower.includes(k)) ? 'analysis' : actionKw.some(k => lower.includes(k)) ? 'action' : 'general',
    input_length: len,
    needs_memory: memoryKw.some(k => lower.includes(k)),
    needs_deep_reasoning: analysisKw.some(k => lower.includes(k)) || len > 2000,
    needs_multimodal: multimodalKw.some(k => lower.includes(k)),
    needs_live_data: liveDataKw.some(k => lower.includes(k)),
    confidence: len < 20 ? 0.9 : len > 5000 ? 0.5 : 0.7,
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
        max_tokens: 500,
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
): Promise<{ enrichment: string | null; debug: InfinityRouterResult | null }> {
  const start = Date.now();
  let fallback = false;

  try {
    const classification = classifyMessage(messages);
    const scores = scoreRoutes(classification);
    const path = pickRoute(scores);

    console.log(`[InfinityRouter] Path: ${path}, Scores:`, scores);

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
    };
  } catch (e) {
    console.error('[InfinityRouter] Error, falling back:', e);
    return { enrichment: null, debug: debugMode ? { path: 'default_chat', scores: { gemini_flash: 0, gemini_pro: 0, retrieval: 0, action: 0, default_chat: 10 }, classification: { intent: 'error', input_length: 0, needs_memory: false, needs_deep_reasoning: false, needs_multimodal: false, needs_live_data: false, confidence: 0 }, enrichment: null, timing_ms: Date.now() - start, fallback: true } : null };
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
        model: 'gpt-4.1-nano-2025-04-14',
        messages: [
          { role: 'system', content: extractionPrompt },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 1024,
        temperature: 0.2,
      }),
    });

    if (!res.ok) { console.error('[PostTurnMemory] AI call failed:', res.status); return; }
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

  try {
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
    } = body;

    // Store auth context for tool handlers (create_work_task needs user ID)
    (globalThis as Record<string, unknown>).__currentAuthHeader = req.headers.get('Authorization') || undefined;
    (globalThis as Record<string, unknown>).__currentSessionId = body.sessionId || undefined;

    const modelConfig = MODEL_REGISTRY[model] || MODEL_REGISTRY[DEFAULT_MODEL];
    const apiKey = Deno.env.get(modelConfig.apiKeyEnvVar);
    if (!apiKey) throw new Error(`${modelConfig.apiKeyEnvVar} is not configured`);

    // Build system prompt
    let systemPrompt = buildSystemPrompt(systemName, userSettings);

    // Infinity Router — additive pre-processing
    let infinityDebug: InfinityRouterResult | null = null;
    const routerEnabled = Deno.env.get('INFINITY_ROUTER_ENABLED') === 'true';
    if (routerEnabled) {
      try {
        const debugMode = Deno.env.get('INFINITY_ROUTER_DEBUG') === 'true';
        const routerResult = await runInfinityRouter(messages, debugMode);
        if (routerResult.enrichment) systemPrompt += routerResult.enrichment;
        infinityDebug = routerResult.debug;
        console.log('[InfinityRouter] Complete', infinityDebug?.path, infinityDebug?.timing_ms + 'ms');
      } catch (e) {
        console.error('[InfinityRouter] Fallback to default:', e);
      }
    }

    // Get Maton connections for data injection AND tool availability
    const MATON_API_KEY = Deno.env.get('MATON_API_KEY');
    const connMap: MultiConnMap = new Map();
    let availableTools: ToolDef[] = [];
    let aliasMap: AliasEntry[] = [];

    if (MATON_API_KEY) {
      try {
        // Get connections and build multi-account map
        const connections = await getMatonConnections(MATON_API_KEY);
        const builtMap = buildMultiConnMap(connections);
        for (const [app, entries] of builtMap) connMap.set(app, entries);
        console.log(`Maton connections loaded: ${connMap.size} apps`, Array.from(connMap.keys()));

        // Build dynamic alias map from all connections
        aliasMap = buildDynamicAliasMap(connMap);
        console.log(`Dynamic alias map built: ${aliasMap.length} aliases`);

        // Determine available tools based on active connections
        availableTools = getAvailableTools(connMap);
        console.log(`Available action tools: ${availableTools.length}`, availableTools.map(t => t.function.name));

        // Add connected services info to system prompt with account details
        if (connMap.size > 0) {
          const connectedServices = Array.from(connMap.entries()).map(([app, entries]) => {
            const label = SERVICE_DETECTORS.find(s => s.app === app)?.label || app;
            if (entries.length > 1) {
              const accounts = entries.map(e => e.email || e.id).join(', ');
              return `- ${label} (${entries.length} accounts: ${accounts})`;
            }
            const email = entries[0]?.email;
            return `- ${label}${email ? ` (${email})` : ''}`;
          }).join('\n');
          systemPrompt += `\n\n===========================================================
CONNECTED SERVICES (you can read data and take actions on these)
===========================================================\n${connectedServices}`;

          // Add multi-account instruction if any service has multiple accounts
          const multiAccountServices = Array.from(connMap.entries()).filter(([, entries]) => entries.length > 1);
          if (multiAccountServices.length > 0) {
            // Build dynamic examples from actual connected accounts
            const dynamicExamples: string[] = [];
            const identityList: string[] = [];
            for (const [app, entries] of multiAccountServices) {
              const label = SERVICE_DETECTORS.find(s => s.app === app)?.label || app;
              for (const e of entries) {
                if (!e.email) continue;
                const email = e.email.toLowerCase();
                const domain = email.split('@')[1]?.split('.')[0] || '';
                const fullDomain = email.split('@')[1] || '';
                dynamicExamples.push(`   - "${email}" → account: "${email}"`);
                dynamicExamples.push(`   - "${email} ${label.toLowerCase()}" → account: "${email}"`);
                if (domain.length >= 3) {
                  dynamicExamples.push(`   - "my ${domain} email" → account: "${email}" (domain alias)`);
                  dynamicExamples.push(`   - "${domain} inbox" → account: "${email}"`);
                }
                identityList.push(`  * ${email} (aliases: "${domain}", "${fullDomain}")`);
              }
            }

            systemPrompt += `\n\n===========================================================
CONTEXT-SENSITIVE ACCOUNT RESOLUTION (CRITICAL)
===========================================================
CONNECTED IDENTITIES:
${identityList.join('\n')}

RESOLUTION RULES — follow this priority order:
1. If the user explicitly mentions an email, brand, domain, or workspace name → use that account.
2. If the user mentions contextual keywords that imply a specific account (e.g. a business name that matches a domain) → use that account.
3. Scan the conversation for context clues before defaulting. Use the most relevant account, not the most convenient.
4. If genuinely ambiguous and it would materially affect the outcome → ask which account to use.
5. NEVER silently default to one account when multiple exist and the user has given any signal.

When you identify the account, pass the EXACT email address in the "account" parameter of EVERY tool call.

DYNAMIC EXAMPLES (auto-generated from connected accounts):
${dynamicExamples.join('\n')}

BEHAVIOR:
- Do NOT automatically prioritize whichever account is easiest to access or appears first.
- Do NOT assume one identity is always primary.
- When a connected account is mentioned or implied, resolve through it first, then validate, then respond.
- Every tool result will confirm which account was used — verify it matches the user's intent.
\n`;
            for (const [app, entries] of multiAccountServices) {
              const label = SERVICE_DETECTORS.find(s => s.app === app)?.label || app;
              systemPrompt += `\n${label} accounts:\n`;
              for (const e of entries) {
                systemPrompt += `- ${e.email || 'unknown'} (connection: ${e.id.substring(0, 8)})\n`;
              }
            }
          }
        }

        // Inject read data for detected intents (with alias map for smart resolution)
        const matonInjection = await injectMatonData(messages, MATON_API_KEY, connMap, aliasMap);
        if (matonInjection) systemPrompt += matonInjection;
      } catch (e) {
        console.error('Error in Maton setup:', e);
      }
    }

    // GoHighLevel data injection (separate from Maton - uses its own API key)
    const GHL_API_KEY = Deno.env.get('GHL_API_KEY');
    if (GHL_API_KEY) {
      // Check if user is asking about GHL
      const ghlDetected = detectServiceIntents(messages).includes('gohighlevel');
      if (ghlDetected) {
        try {
          console.log('Fetching GoHighLevel data...');
          const ghlData = await fetchGHLData();
          systemPrompt += `\n\n===========================================================
GOHIGHLEVEL CRM DATA
===========================================================
The following is REAL data from the user's GoHighLevel account. Use this to answer questions about their CRM, pipelines, contacts, etc.\n\n${ghlData}`;
          console.log('GHL data injected');
        } catch (e) {
          console.error('Error fetching GHL data:', e);
        }
      }

      // Add GHL to connected services list
      systemPrompt += `\n- GoHighLevel CRM (contacts, pipelines, opportunities, calendars, conversations, campaigns, workflows)`;

      // If no Maton tools were added, ensure GHL tools are still available
      if (!availableTools.some(t => t.function.name.startsWith('ghl_'))) {
        availableTools = getAvailableTools(connMap);
      }
    }

    // ================================================================
    // WISDOM ENGINE — Multi-source context injection
    // Searches: knowledge entries, wisdom memories, reflection notes
    // ================================================================
    const OPENAI_KEY_FOR_EMBED = Deno.env.get('OPENAI_API_KEY');
    let wisdomUserId: string | null = null;

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

                // Run all three searches in parallel
                const [knowledgeRes, memoriesRes, reflectionsRes] = await Promise.all([
                  adminClient.rpc('match_knowledge', {
                    query_embedding: JSON.stringify(queryEmbedding),
                    match_threshold: 0.45,
                    match_count: 8,
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

                // Inject knowledge
                const knowledgeResults = knowledgeRes.data || [];
                if (knowledgeResults.length > 0) {
                  const injection = knowledgeResults.map((k: { source_person: string; title: string; content: string; category: string; domain: string; similarity: number }) =>
                    `**${k.title}** (${k.source_person} - ${k.category}/${k.domain}, relevance: ${(k.similarity * 100).toFixed(0)}%)\n${k.content}`
                  ).join('\n\n');
                  systemPrompt += `\n\n===========================================================
KNOWLEDGE REPOSITORY - RELEVANT WISDOM
===========================================================
Apply these frameworks naturally when giving advice.\n\n${injection}`;
                  console.log(`Injected ${knowledgeResults.length} knowledge entries`);
                }

                // Inject memories
                const memoryResults = memoriesRes.data || [];
                if (memoryResults.length > 0) {
                  const injection = memoryResults.map((m: { memory_type: string; content: string; summary: string; confidence: number }) =>
                    `[${m.memory_type}] ${m.summary || m.content} (confidence: ${(m.confidence * 100).toFixed(0)}%)`
                  ).join('\n');
                  systemPrompt += `\n\n===========================================================
LIVING MEMORY - WHAT I KNOW ABOUT THIS USER
===========================================================
These are durable facts, preferences, and patterns I've learned about the user. Use them to personalize responses. Distinguish between known memory and inference.\n\n${injection}`;
                  console.log(`Injected ${memoryResults.length} memories`);

                  // Update last_accessed_at for matched memories
                  const memIds = memoryResults.map((m: { id: string }) => m.id);
                  adminClient.from('wisdom_memories').update({ last_accessed_at: new Date().toISOString() }).in('id', memIds).then(() => {});
                }

                // Inject reflections
                const reflectionResults = reflectionsRes.data || [];
                if (reflectionResults.length > 0) {
                  const injection = reflectionResults.map((r: { note_type: string; content: string; importance: number }) =>
                    `[${r.note_type}] ${r.content}`
                  ).join('\n');
                  systemPrompt += `\n\n===========================================================
REFLECTION LAYER - SYNTHESIZED INSIGHTS
===========================================================
These are patterns and lessons distilled from past conversations.\n\n${injection}`;
                  console.log(`Injected ${reflectionResults.length} reflections`);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Wisdom Engine injection error:', e);
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
    if ((isActionRequest || enableTools) && availableTools.length > 0 && MATON_API_KEY) {
      console.log('Using tool loop (non-streaming) for action request');

      try {
        // Use TransformStream for real-time SSE streaming of task updates
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Run tool loop in background, streaming task updates as they happen
        (async () => {
          try {
            // Emit infinity router debug event if available
            if (infinityDebug) {
              await writer.write(encoder.encode(`event: infinity_router_debug\ndata: ${JSON.stringify(infinityDebug)}\n\n`));
            }

            const result = await runToolLoop(
              modelConfig, apiKey, openAIMessages, availableTools, MATON_API_KEY, connMap, 10,
              async (event) => {
                try {
                  await writer.write(encoder.encode(`event: task_update\ndata: ${JSON.stringify(event)}\n\n`));
                } catch { /* stream closed */ }
              },
              userText,
              aliasMap,
              wisdomUserId,
            );

            // Write final content as SSE
            await writer.write(encoder.encode(`data: ${JSON.stringify({
              choices: [{ delta: { content: result.content }, finish_reason: 'stop' }],
            })}\n\n`));
            await writer.write(encoder.encode('data: [DONE]\n\n'));

            // Fire-and-forget: post-turn memory extraction
            if (wisdomUserId) {
              extractPostTurnMemories(messages, result.content, wisdomUserId).catch(e =>
                console.error('[PostTurnMemory] Error:', e)
              );
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
    const requestPayload: Record<string, unknown> = {
      model: modelConfig.name,
      messages: openAIMessages,
      max_completion_tokens: modelConfig.maxTokens,
      stream: true,
    };

    const response = await fetch(modelConfig.apiEndpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'AI service error', details: errorText }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If we have infinity debug data, prepend it to the stream
    if (infinityDebug) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      (async () => {
        try {
          await writer.write(encoder.encode(`event: infinity_router_debug\ndata: ${JSON.stringify(infinityDebug)}\n\n`));
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
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    console.error('Chat function error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
