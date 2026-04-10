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
  { app: 'gohighlevel', label: 'GoHighLevel', keywords: ['gohighlevel', 'ghl', 'high level', 'highlevel', 'go high level', 'leadconnector', 'lead connector', 'sub-account', 'subaccount', 'pipeline', 'pipelines', 'opportunity', 'opportunities', 'funnels', 'funnel', 'workflows', 'workflow', 'campaigns', 'campaign', 'conversations', 'conversation'] },
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
  const sitesData = await callMatonGateway(key, '/google-search-console/webmasters/v3/sites', connId) as { siteEntry?: { siteUrl: string }[] };
  const sites = sitesData.siteEntry || [];
  if (!sites.length) return 'No sites found in GSC.';
  const recentEnd = new Date(); recentEnd.setDate(recentEnd.getDate() - 2);
  const recentStart = new Date(); recentStart.setDate(recentStart.getDate() - 8);
  const priorEnd = new Date(); priorEnd.setDate(priorEnd.getDate() - 9);
  const priorStart = new Date(); priorStart.setDate(priorStart.getDate() - 15);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const reports: string[] = [];
  for (const site of sites) {
    try {
      const [recentData, priorData] = await Promise.all([
        callMatonGateway(key, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`, connId, 'POST', { startDate: fmt(recentStart), endDate: fmt(recentEnd), dimensions: ['query'], rowLimit: 25 }),
        callMatonGateway(key, `/google-search-console/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`, connId, 'POST', { startDate: fmt(priorStart), endDate: fmt(priorEnd), dimensions: ['query'], rowLimit: 25 }),
      ]) as [{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }, { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }];
      const rRows = recentData.rows || []; const pRows = priorData.rows || [];
      const rT = rRows.reduce((a, r) => ({ c: a.c + r.clicks, i: a.i + r.impressions }), { c: 0, i: 0 });
      const pT = pRows.reduce((a, r) => ({ c: a.c + r.clicks, i: a.i + r.impressions }), { c: 0, i: 0 });
      let r = `### ${site.siteUrl}\n`;
      r += `**Last 7 days (${fmt(recentStart)} to ${fmt(recentEnd)}):** ${rT.c} clicks, ${rT.i} impressions\n`;
      r += `**Prior 7 days (${fmt(priorStart)} to ${fmt(priorEnd)}):** ${pT.c} clicks, ${pT.i} impressions\n`;
      const clickChange = pT.c > 0 ? ((rT.c - pT.c) / pT.c * 100).toFixed(1) : 'N/A';
      const impChange = pT.i > 0 ? ((rT.i - pT.i) / pT.i * 100).toFixed(1) : 'N/A';
      r += `**Change:** Clicks ${clickChange}% | Impressions ${impChange}%\n`;
      if (rRows.length) { r += '\nTop queries:\n'; for (const row of rRows.slice(0, 10)) r += `- "${row.keys[0]}": ${row.clicks} clicks, ${row.impressions} imp, pos ${row.position.toFixed(1)}, CTR ${(row.ctr*100).toFixed(1)}%\n`; }
      reports.push(r);
    } catch (e) { reports.push(`### ${site.siteUrl}\nError: ${e instanceof Error ? e.message : 'Unknown'}`); }
  }
  return reports.join('\n');
}

async function fetchGmailData(key: string, connId: string): Promise<string> {
  const data = await callMatonGateway(key, '/google-mail/gmail/v1/users/me/messages?maxResults=15&q=is:unread', connId) as { messages?: { id: string }[]; resultSizeEstimate?: number };
  const msgs = data.messages || [];
  if (!msgs.length) return 'No unread emails.';
  const details: string[] = [`Unread count: ~${data.resultSizeEstimate || msgs.length}`];
  for (const m of msgs.slice(0, 8)) {
    try {
      const full = await callMatonGateway(key, `/google-mail/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, connId) as { payload?: { headers?: { name: string; value: string }[] }; snippet?: string };
      const headers = full.payload?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const date = headers.find(h => h.name === 'Date')?.value || '';
      details.push(`- From: ${from} | Subject: ${subject} | ${date}\n  Preview: ${(full.snippet || '').substring(0, 120)}`);
    } catch { details.push(`- Message ${m.id}: could not load`); }
  }
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
): Promise<string> {
  const detectedApps = detectServiceIntents(messages);
  if (!detectedApps.length) return '';
  console.log('Detected service intents:', detectedApps);
  const connections = await getMatonConnections(matonApiKey);
  const connMap = new Map<string, string>();
  for (const c of connections) { if (!connMap.has(c.app)) connMap.set(c.app, c.connection_id); }

  const sections: string[] = [];
  const notConnected: string[] = [];

  await Promise.all(detectedApps.map(async (app) => {
    const connId = connMap.get(app);
    if (!connId) { notConnected.push(SERVICE_DETECTORS.find(s => s.app === app)?.label || app); return; }
    const fetcher = SERVICE_FETCHERS[app];
    if (!fetcher) { sections.push(`## ${app}\nConnected but no data fetcher configured.`); return; }
    try {
      const data = await fetcher(matonApiKey, connId);
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
    injection += `\n\nNote: The user asked about ${notConnected.join(', ')} but ${notConnected.length === 1 ? "it isn't" : "they aren't"} connected yet. Let them know they can connect in Settings > Maton AI Integrations.`;
  }
  return injection;
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
      description: 'Send an email via Gmail. Use when the user asks to send, compose, or email someone.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body text (plain text)' },
          cc: { type: 'string', description: 'CC email address (optional)' },
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
        },
        required: ['to', 'subject', 'body'],
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
];

// ============================================================================
// TOOL EXECUTION ENGINE - Executes tool calls via Maton Gateway
// ============================================================================

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  matonApiKey: string,
  connMap: Map<string, string>,
): Promise<{ success: boolean; result: string }> {
  try {
    switch (toolName) {
      case 'send_email': {
        const connId = connMap.get('google-mail');
        if (!connId) return { success: false, result: 'Gmail is not connected. Ask the user to connect it in Settings > Maton AI Integrations.' };
        const raw = buildRawEmail(args.to as string, args.subject as string, args.body as string, args.cc as string | undefined);
        const res = await callMatonGateway(matonApiKey, '/google-mail/gmail/v1/users/me/messages/send', connId, 'POST', { raw }) as { id?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to send: ${res.error.message || JSON.stringify(res.error)}` };
        return { success: true, result: `Email sent successfully (ID: ${res.id}). To: ${args.to}, Subject: "${args.subject}"` };
      }

      case 'create_email_draft': {
        const connId = connMap.get('google-mail');
        if (!connId) return { success: false, result: 'Gmail is not connected.' };
        const raw = buildRawEmail(args.to as string, args.subject as string, args.body as string);
        const res = await callMatonGateway(matonApiKey, '/google-mail/gmail/v1/users/me/drafts', connId, 'POST', { message: { raw } }) as { id?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create draft: ${res.error.message || JSON.stringify(res.error)}` };
        return { success: true, result: `Draft created successfully (ID: ${res.id}). To: ${args.to}, Subject: "${args.subject}"` };
      }

      case 'create_calendar_event': {
        const connId = connMap.get('google-calendar');
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
        const connId = connMap.get('slack');
        if (!connId) return { success: false, result: 'Slack is not connected.' };
        const res = await callMatonGateway(matonApiKey, '/slack/api/chat.postMessage', connId, 'POST', {
          channel: args.channel,
          text: args.text,
        }) as { ok?: boolean; error?: string; ts?: string };
        if (!res.ok) return { success: false, result: `Slack error: ${res.error || 'Unknown error'}` };
        return { success: true, result: `Message sent to ${args.channel}: "${(args.text as string).substring(0, 100)}..."` };
      }

      case 'create_notion_page': {
        const connId = connMap.get('notion');
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
        const connId = connMap.get('github');
        if (!connId) return { success: false, result: 'GitHub is not connected.' };
        const issueData: Record<string, unknown> = { title: args.title, body: args.body };
        if (args.labels) issueData.labels = (args.labels as string).split(',').map(l => l.trim());
        const res = await callMatonGateway(matonApiKey, `/github/repos/${args.owner}/${args.repo}/issues`, connId, 'POST', issueData) as { number?: number; html_url?: string; error?: string; message?: string };
        if (res.message) return { success: false, result: `GitHub error: ${res.message}` };
        return { success: true, result: `Issue #${res.number} created: "${args.title}" - ${res.html_url || ''}` };
      }

      case 'create_hubspot_contact': {
        const connId = connMap.get('hubspot');
        if (!connId) return { success: false, result: 'HubSpot is not connected.' };
        const props: Record<string, string> = { email: args.email as string, firstname: args.firstname as string, lastname: args.lastname as string };
        if (args.phone) props.phone = args.phone as string;
        if (args.company) props.company = args.company as string;
        const res = await callMatonGateway(matonApiKey, '/hubspot/crm/v3/objects/contacts', connId, 'POST', { properties: props }) as { id?: string; error?: string; message?: string };
        if (res.message) return { success: false, result: `HubSpot error: ${res.message}` };
        return { success: true, result: `Contact created: ${args.firstname} ${args.lastname} (${args.email}) - ID: ${res.id}` };
      }

      case 'create_hubspot_deal': {
        const connId = connMap.get('hubspot');
        if (!connId) return { success: false, result: 'HubSpot is not connected.' };
        const props: Record<string, string> = { dealname: args.dealname as string, amount: args.amount as string };
        if (args.dealstage) props.dealstage = args.dealstage as string;
        if (args.pipeline) props.pipeline = args.pipeline as string;
        const res = await callMatonGateway(matonApiKey, '/hubspot/crm/v3/objects/deals', connId, 'POST', { properties: props }) as { id?: string; message?: string };
        if (res.message) return { success: false, result: `HubSpot error: ${res.message}` };
        return { success: true, result: `Deal created: "${args.dealname}" ($${args.amount}) - ID: ${res.id}` };
      }

      case 'search_google_drive': {
        const connId = connMap.get('google-drive');
        if (!connId) return { success: false, result: 'Google Drive is not connected.' };
        const maxResults = (args.max_results as number) || 10;
        const q = encodeURIComponent(`name contains '${args.query}' or fullText contains '${args.query}'`);
        const data = await callMatonGateway(matonApiKey, `/google-drive/drive/v3/files?q=${q}&pageSize=${maxResults}&fields=files(id,name,mimeType,modifiedTime,webViewLink)`, connId) as { files?: { name: string; mimeType: string; modifiedTime: string; webViewLink?: string }[] };
        const files = data.files || [];
        if (!files.length) return { success: true, result: `No files found matching "${args.query}"` };
        return { success: true, result: `Found ${files.length} files:\n${files.map(f => `- ${f.name} (${f.mimeType?.split('.').pop()}) - ${f.webViewLink || ''}`).join('\n')}` };
      }

      case 'create_trello_card': {
        const connId = connMap.get('trello');
        if (!connId) return { success: false, result: 'Trello is not connected.' };
        const cardData: Record<string, unknown> = { idList: args.list_id, name: args.name };
        if (args.desc) cardData.desc = args.desc;
        const res = await callMatonGateway(matonApiKey, '/trello/1/cards', connId, 'POST', cardData) as { id?: string; url?: string; error?: string };
        if (res.error) return { success: false, result: `Trello error: ${res.error}` };
        return { success: true, result: `Card created: "${args.name}" - ${res.url || ''}` };
      }

      case 'create_jira_issue': {
        const connId = connMap.get('jira');
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

      // ============ Google Docs tools ============
      case 'create_google_doc': {
        const connId = connMap.get('google-drive');
        if (!connId) return { success: false, result: 'Google Drive is not connected (needed for Docs).' };
        const fileMetadata = { name: args.title, mimeType: 'application/vnd.google-apps.document' };
        const res = await callMatonGateway(matonApiKey, '/google-drive/drive/v3/files?fields=id,name,webViewLink', connId, 'POST', fileMetadata) as { id?: string; name?: string; webViewLink?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create doc: ${res.error.message || JSON.stringify(res.error)}` };
        const link = res.webViewLink || `https://docs.google.com/document/d/${res.id}/edit`;
        let result = `Google Doc created: "${args.title}" — ${link}`;
        if (args.content) {
          try {
            const docConnId = connMap.get('google-docs') || connId;
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
        const connId = connMap.get('google-drive');
        if (!connId) return { success: false, result: 'Google Drive is not connected (needed for Sheets).' };
        const fileMetadata = { name: args.title, mimeType: 'application/vnd.google-apps.spreadsheet' };
        const res = await callMatonGateway(matonApiKey, '/google-drive/drive/v3/files?fields=id,name,webViewLink', connId, 'POST', fileMetadata) as { id?: string; name?: string; webViewLink?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create sheet: ${res.error.message || JSON.stringify(res.error)}` };
        const link = res.webViewLink || `https://docs.google.com/spreadsheets/d/${res.id}/edit`;
        return { success: true, result: `Google Sheet created: "${args.title}" — ${link}` };
      }

      case 'read_sheet_data': {
        const connId = connMap.get('google-sheets') || connMap.get('google-drive');
        if (!connId) return { success: false, result: 'Google Sheets is not connected.' };
        const range = encodeURIComponent((args.range as string) || 'Sheet1');
        const data = await callMatonGateway(matonApiKey, `/google-sheets/v4/spreadsheets/${args.spreadsheet_id}/values/${range}`, connId) as { values?: string[][]; error?: { message?: string } };
        if (data.error) return { success: false, result: `Failed to read sheet: ${data.error.message}` };
        const rows = data.values || [];
        if (!rows.length) return { success: true, result: 'Sheet is empty or range has no data.' };
        return { success: true, result: `Read ${rows.length} rows:\n${rows.slice(0, 50).map(r => r.join(' | ')).join('\n')}${rows.length > 50 ? `\n... and ${rows.length - 50} more rows` : ''}` };
      }

      case 'append_sheet_rows': {
        const connId = connMap.get('google-sheets') || connMap.get('google-drive');
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
        const connId = connMap.get('google-drive');
        if (!connId) return { success: false, result: 'Google Drive is not connected (needed for Slides).' };
        const fileMetadata = { name: args.title, mimeType: 'application/vnd.google-apps.presentation' };
        const res = await callMatonGateway(matonApiKey, '/google-drive/drive/v3/files?fields=id,name,webViewLink', connId, 'POST', fileMetadata) as { id?: string; name?: string; webViewLink?: string; error?: { message?: string } };
        if (res.error) return { success: false, result: `Failed to create presentation: ${res.error.message || JSON.stringify(res.error)}` };
        const link = res.webViewLink || `https://docs.google.com/presentation/d/${res.id}/edit`;
        return { success: true, result: `Google Slides presentation created: "${args.title}" — ${link}` };
      }

      // ============ ClickUp tools ============
      case 'create_clickup_task': {
        const connId = connMap.get('clickup');
        if (!connId) return { success: false, result: 'ClickUp is not connected.' };
        const taskData: Record<string, unknown> = { name: args.name };
        if (args.description) taskData.description = args.description;
        if (args.priority) taskData.priority = args.priority;
        const res = await callMatonGateway(matonApiKey, `/clickup/api/v2/list/${args.list_id}/task`, connId, 'POST', taskData) as { id?: string; name?: string; url?: string; err?: string };
        if (res.err) return { success: false, result: `ClickUp error: ${res.err}` };
        return { success: true, result: `Task created: "${args.name}" — ${res.url || `https://app.clickup.com/t/${res.id}`}` };
      }

      case 'list_clickup_tasks': {
        const connId = connMap.get('clickup');
        if (!connId) return { success: false, result: 'ClickUp is not connected.' };
        const data = await callMatonGateway(matonApiKey, `/clickup/api/v2/list/${args.list_id}/task?page=0`, connId) as { tasks?: { id: string; name: string; status?: { status?: string }; url?: string; priority?: { priority?: string } }[] };
        const tasks = data.tasks || [];
        if (!tasks.length) return { success: true, result: 'No tasks in this list.' };
        return { success: true, result: `Found ${tasks.length} tasks:\n${tasks.map(t => `- ${t.name} (${t.status?.status || '?'}) — ${t.url || `https://app.clickup.com/t/${t.id}`}`).join('\n')}` };
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

You are the intelligence, memory, and action layer of ${osName}.`;
};

// ============================================================================
// DETERMINE WHICH TOOLS ARE AVAILABLE BASED ON CONNECTIONS
// ============================================================================

function getAvailableTools(connMap: Map<string, string>): ToolDef[] {
  const GHL_API_KEY = Deno.env.get('GHL_API_KEY');
  const hasGHL = !!GHL_API_KEY;

  const toolToService: Record<string, string> = {
    'send_email': 'google-mail',
    'create_email_draft': 'google-mail',
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
  };

  return MATON_ACTION_TOOLS.filter(tool => {
    const requiredService = toolToService[tool.function.name];
    if (requiredService === 'ghl') return hasGHL;
    return requiredService ? connMap.has(requiredService) : true;
  });
}

// ============================================================================
// NON-STREAMING TOOL LOOP - For when tools need to be called
// ============================================================================

async function runToolLoop(
  modelConfig: ModelConfig,
  apiKey: string,
  openAIMessages: { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[],
  tools: ToolDef[],
  matonApiKey: string,
  connMap: Map<string, string>,
  maxIterations = 5,
): Promise<{ role: string; content: string }> {
  let iteration = 0;

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
      console.log(`AI requested ${msg.tool_calls.length} tool calls:`, msg.tool_calls.map((tc: { function: { name: string } }) => tc.function.name));

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        msg.tool_calls.map(async (tc: { id: string; function: { name: string; arguments: string } }) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          console.log(`Executing tool: ${tc.function.name}`, args);
          const result = await executeToolCall(tc.function.name, args, matonApiKey, connMap);
          console.log(`Tool result (${tc.function.name}):`, result.success ? 'SUCCESS' : 'FAILED', result.result.substring(0, 200));
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
    return { role: 'assistant', content: msg.content || '' };
  }

  return { role: 'assistant', content: 'I tried to complete the action but hit the maximum number of steps. Please try again with a simpler request.' };
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
      agentId: _agentId,
      agentMetadata: _agentMetadata,
      enableTools = false,
      userSettings,
    } = await req.json();

    const modelConfig = MODEL_REGISTRY[model] || MODEL_REGISTRY[DEFAULT_MODEL];
    const apiKey = Deno.env.get(modelConfig.apiKeyEnvVar);
    if (!apiKey) throw new Error(`${modelConfig.apiKeyEnvVar} is not configured`);

    // Build system prompt
    let systemPrompt = buildSystemPrompt(systemName, userSettings);

    // Get Maton connections for data injection AND tool availability
    const MATON_API_KEY = Deno.env.get('MATON_API_KEY');
    const connMap = new Map<string, string>();
    let availableTools: ToolDef[] = [];

    if (MATON_API_KEY) {
      try {
        // Get connections
        const connections = await getMatonConnections(MATON_API_KEY);
        for (const c of connections) { if (!connMap.has(c.app)) connMap.set(c.app, c.connection_id); }
        console.log(`Maton connections loaded: ${connMap.size} active`, Array.from(connMap.keys()));

        // Determine available tools based on active connections
        availableTools = getAvailableTools(connMap);
        console.log(`Available action tools: ${availableTools.length}`, availableTools.map(t => t.function.name));

        // Add connected services info to system prompt
        if (connMap.size > 0) {
          const connectedServices = Array.from(connMap.keys()).map(app => {
            const label = SERVICE_DETECTORS.find(s => s.app === app)?.label || app;
            return `- ${label}`;
          }).join('\n');
          systemPrompt += `\n\n===========================================================
CONNECTED SERVICES (you can read data and take actions on these)
===========================================================\n${connectedServices}`;
        }

        // Inject read data for detected intents
        const matonInjection = await injectMatonData(messages, MATON_API_KEY);
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
    const actionKeywords = ['send', 'create', 'schedule', 'book', 'post', 'draft', 'compose', 'write to', 'message', 'notify', 'add contact', 'add deal', 'make a', 'set up', 'file a', 'open an issue', 'open a ticket', 'list contacts', 'list pipelines', 'list opportunities', 'list workflows', 'list campaigns', 'list calendars', 'add tag', 'show my contacts', 'show my pipeline', 'show my deals', 'ghl', 'gohighlevel', 'high level', 'create a doc', 'create a sheet', 'create a spreadsheet', 'new spreadsheet', 'new doc', 'new document', 'create a presentation', 'new presentation', 'new slide', 'read sheet', 'append', 'add rows', 'create task', 'list tasks', 'clickup'];
    const isActionRequest = actionKeywords.some(k => userText.includes(k));

    // If this looks like an action request and we have tools, use the tool loop (non-streaming)
    if ((isActionRequest || enableTools) && availableTools.length > 0 && MATON_API_KEY) {
      console.log('Using tool loop (non-streaming) for action request');

      try {
        const result = await runToolLoop(modelConfig, apiKey, openAIMessages, availableTools, MATON_API_KEY, connMap);

        // Return as a simulated SSE stream so the frontend can handle it the same way
        const ssePayload = `data: ${JSON.stringify({
          choices: [{ delta: { content: result.content }, finish_reason: 'stop' }],
        })}\n\ndata: [DONE]\n\n`;

        return new Response(ssePayload, {
          headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
        });
      } catch (e) {
        console.error('Tool loop error:', e);
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
