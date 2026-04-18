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
  const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
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
// SERVICE DATA FETCHERS (READ) — All native edge functions, no Maton.
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
  // ClickUp actions (via dedicated edge function, not Maton)
  {
    type: 'function',
    function: {
      name: 'create_clickup_task',
      description: 'Create a new task in ClickUp. The list_id is optional — if omitted, the configured default list is used.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string', description: 'ClickUp list ID (optional, uses default list if omitted)' },
          name: { type: 'string', description: 'Task name' },
          description: { type: 'string', description: 'Task description (optional)' },
          priority: { type: 'number', description: 'Priority: 1=Urgent, 2=High, 3=Normal, 4=Low (optional)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clickup_tasks',
      description: 'List tasks from a ClickUp list. If list_id is omitted, uses the configured default list.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string', description: 'ClickUp list ID (optional, uses default list if omitted)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_clickup_task',
      description: 'Get full details of a ClickUp task by ID.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_clickup_task',
      description: 'Update an existing ClickUp task (name, description, priority).',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' }, name: { type: 'string', description: 'New name (optional)' }, description: { type: 'string', description: 'New description (optional)' }, priority: { type: 'number', description: '1=Urgent 2=High 3=Normal 4=Low (optional)' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_clickup_task',
      description: 'Delete a ClickUp task permanently.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_clickup_task_status',
      description: 'Change the status of a ClickUp task (e.g. "open", "in progress", "complete").',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' }, status: { type: 'string', description: 'New status value' } }, required: ['task_id', 'status'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_clickup_due_date',
      description: 'Set or clear a due date on a ClickUp task. Pass Unix timestamp in ms.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' }, due_date: { type: 'number', description: 'Unix timestamp in ms, or null to clear' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_clickup_assignees',
      description: 'Add or remove assignees on a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' }, add: { type: 'array', items: { type: 'number' }, description: 'User IDs to add' }, rem: { type: 'array', items: { type: 'number' }, description: 'User IDs to remove' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_clickup_subtask',
      description: 'Create a subtask under a parent ClickUp task.',
      parameters: { type: 'object', properties: { parent_id: { type: 'string', description: 'Parent task ID' }, name: { type: 'string', description: 'Subtask name' }, description: { type: 'string', description: 'Subtask description (optional)' } }, required: ['parent_id', 'name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_clickup_comment',
      description: 'Add a comment to a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' }, comment_text: { type: 'string', description: 'Comment body text' } }, required: ['task_id', 'comment_text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clickup_comments',
      description: 'List comments on a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_clickup_comment',
      description: 'Edit an existing comment in ClickUp.',
      parameters: { type: 'object', properties: { comment_id: { type: 'string', description: 'Comment ID' }, comment_text: { type: 'string', description: 'Updated text' } }, required: ['comment_id', 'comment_text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_clickup_comment',
      description: 'Delete a comment from ClickUp.',
      parameters: { type: 'object', properties: { comment_id: { type: 'string', description: 'Comment ID' } }, required: ['comment_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_clickup_tag',
      description: 'Add a tag to a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' }, tag: { type: 'string', description: 'Tag name' } }, required: ['task_id', 'tag'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_clickup_tag',
      description: 'Remove a tag from a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' }, tag: { type: 'string', description: 'Tag name' } }, required: ['task_id', 'tag'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_clickup_checklist',
      description: 'Add a checklist to a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'ClickUp task ID' }, name: { type: 'string', description: 'Checklist name' } }, required: ['task_id', 'name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_clickup_checklist_item',
      description: 'Add an item to an existing ClickUp checklist.',
      parameters: { type: 'object', properties: { checklist_id: { type: 'string', description: 'Checklist ID' }, name: { type: 'string', description: 'Item name' } }, required: ['checklist_id', 'name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_clickup_checklist_item',
      description: 'Toggle resolved or rename a checklist item.',
      parameters: { type: 'object', properties: { checklist_id: { type: 'string', description: 'Checklist ID' }, checklist_item_id: { type: 'string', description: 'Item ID' }, name: { type: 'string', description: 'New name (optional)' }, resolved: { type: 'boolean', description: 'Mark resolved or unresolved (optional)' } }, required: ['checklist_id', 'checklist_item_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_clickup_tasks',
      description: 'Search tasks across the entire ClickUp workspace by keyword, status, assignee, tags, or due date.',
      parameters: { type: 'object', properties: { statuses: { type: 'array', items: { type: 'string' }, description: 'Filter by statuses (optional)' }, assignees: { type: 'array', items: { type: 'number' }, description: 'Filter by assignee user IDs (optional)' }, tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (optional)' }, due_date_gt: { type: 'number', description: 'Due date after (Unix ms, optional)' }, due_date_lt: { type: 'number', description: 'Due date before (Unix ms, optional)' }, include_closed: { type: 'boolean', description: 'Include closed tasks (optional)' }, subtasks: { type: 'boolean', description: 'Include subtasks (optional)' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clickup_spaces',
      description: 'List all spaces in the ClickUp workspace.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clickup_lists',
      description: 'List all lists across the entire ClickUp workspace (all spaces and folders).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clickup_members',
      description: 'List all members in the ClickUp workspace. Use to discover user IDs for assignee operations.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_clickup_task',
      description: 'Move a ClickUp task to a different list.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Task ID to move' }, list_id: { type: 'string', description: 'Destination list ID' } }, required: ['task_id', 'list_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_clickup_priority',
      description: 'Set the priority of a ClickUp task. 1=Urgent, 2=High, 3=Normal, 4=Low.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Task ID' }, priority: { type: 'number', description: '1=Urgent, 2=High, 3=Normal, 4=Low' } }, required: ['task_id', 'priority'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_clickup_timer',
      description: 'Start a time tracking timer on a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Task ID to track time on' }, description: { type: 'string', description: 'Timer description (optional)' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_clickup_timer',
      description: 'Stop the currently running ClickUp time tracking timer.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_clickup_time_entries',
      description: 'Get time tracking entries from ClickUp.',
      parameters: { type: 'object', properties: { start_date: { type: 'number', description: 'Start date Unix ms (optional)' }, end_date: { type: 'number', description: 'End date Unix ms (optional)' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_clickup_custom_fields',
      description: 'List custom fields available on a ClickUp list.',
      parameters: { type: 'object', properties: { list_id: { type: 'string', description: 'List ID' } }, required: ['list_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_clickup_custom_field',
      description: 'Set a custom field value on a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Task ID' }, field_id: { type: 'string', description: 'Custom field ID' }, value: { description: 'Value to set' } }, required: ['task_id', 'field_id', 'value'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clickup_task_dependencies',
      description: 'List dependencies and dependents of a ClickUp task.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Task ID' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_clickup_dependency',
      description: 'Add a dependency between two ClickUp tasks (task depends on another).',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Task ID that depends on another' }, depends_on: { type: 'string', description: 'Task ID that this task depends on' } }, required: ['task_id', 'depends_on'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_clickup_dependency',
      description: 'Remove a dependency between two ClickUp tasks.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Task ID' }, depends_on: { type: 'string', description: 'Dependency task ID to remove' } }, required: ['task_id', 'depends_on'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_clickup_checklist',
      description: 'Delete an entire checklist from a ClickUp task.',
      parameters: { type: 'object', properties: { checklist_id: { type: 'string', description: 'Checklist ID' } }, required: ['checklist_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_clickup_checklist_item',
      description: 'Delete an item from a ClickUp checklist.',
      parameters: { type: 'object', properties: { checklist_id: { type: 'string', description: 'Checklist ID' }, checklist_item_id: { type: 'string', description: 'Item ID' } }, required: ['checklist_id', 'checklist_item_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_clickup_list_statuses',
      description: 'Get available statuses for a ClickUp list. Useful to know valid status values before setting task status.',
      parameters: { type: 'object', properties: { list_id: { type: 'string', description: 'List ID' } }, required: ['list_id'] },
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
      description: 'Create a custom field in GoHighLevel for the location.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, dataType: { type: 'string', description: 'TEXT, NUMERICAL, PHONE, MONETARY, CHECKBOX, SINGLE_OPTIONS, MULTIPLE_OPTIONS, DATE, TEXTAREA, RADIO, FILE_UPLOAD, SIGNATURE' }, position: { type: 'number' }, model: { type: 'string', description: 'contact or opportunity', enum: ['contact', 'opportunity'] } }, required: ['name', 'dataType'] },
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
  // ============ Scrape Events Tool ============
  {
    type: 'function',
    function: {
      name: 'scrape_events',
      description: 'Search the web for events (networking, conferences, meetups, etc.) and extract structured event data including dates, locations, and URLs. Stores discovered events for the user. Use when asked to find events, conferences, meetups, networking opportunities, or upcoming dates.',
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
  // ============ Higgsfield AI Tools ============
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
          pinned_comment: { type: 'string', description: 'Comment to post on the video. Auto-pin attempted but may require manual pin in Studio.' },
        },
        required: ['title', 'video_url'],
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

// ============================================================================
// NATIVE GOOGLE WORKSPACE ROUTER
// Routes Gmail/Drive/Calendar/Sheets/Docs/GSC tool calls to native edge
// functions (using the user's own Google OAuth token) instead of Maton.
// Falls through to Maton on any failure.
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
  // Drive
  search_google_drive: { fn: 'google-drive', action: 'search_files', mapArgs: (a) => ({ q: a.query, pageSize: a.max_results }) },
  // Calendar
  create_calendar_event: { fn: 'google-calendar', action: 'create_event', mapArgs: (a) => ({ summary: a.title, description: a.description, start: a.start_time, end: a.end_time, attendees: a.attendees, location: a.location }) },
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
    const payload = {
      action: route.action,
      ...(route.mapArgs ? route.mapArgs(args) : args),
    };
    const res = await fetch(`${supabaseUrl}/functions/v1/${route.fn}`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      console.warn(`[NativeGoogle] ${toolName} failed:`, res.status, JSON.stringify(data).slice(0, 300));
      return null; // fall through to Maton
    }
    console.log(`[NativeGoogle] ${toolName} → ${route.fn}/${route.action} OK`);
    return { success: true, result: `[Native Google Workspace] ${JSON.stringify(data).slice(0, 4000)}` };
  } catch (e) {
    console.warn(`[NativeGoogle] ${toolName} error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ============================================================================
// NATIVE EDGE FUNCTION INVOKER
// Calls a Supabase edge function with the user's auth token.
// All Google services route through here (no Maton).
// ============================================================================
async function callNativeEdge(
  fn: string,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const authHeader = (globalThis as Record<string, unknown>).__currentAuthHeader as string | undefined;
  if (!authHeader) throw new Error('No auth context — user must be signed in');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
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
  ghlCreds?: { apiKey?: string; locationId?: string; subAccounts?: { id: string; name: string; api_key?: string }[] },
): Promise<{ success: boolean; result: string }> {
  try {
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
        const searchBody: Record<string, unknown> = { locationId: GHL_LOCATION_ID, pageSize: (args.limit as number) || 20 };
        if (args.query) searchBody.query = args.query;
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

      // ============ ClickUp tools (via dedicated edge function) ============
      case 'create_clickup_task': {
        try {
          const params: Record<string, unknown> = { name: args.name };
          if (args.list_id) params.listId = args.list_id;
          if (args.description) params.description = args.description;
          if (args.priority) params.priority = args.priority;
          const res = await callClickUpEdge('create_task', params) as { id?: string; name?: string; url?: string };
          return { success: true, result: `Task created: "${args.name}" — ${res.url || `https://app.clickup.com/t/${res.id}`}` };
        } catch (err) {
          return { success: false, result: `ClickUp error: ${(err as Error).message}` };
        }
      }

      case 'list_clickup_tasks': {
        try {
          const params: Record<string, unknown> = {};
          if (args.list_id) params.listId = args.list_id;
          const data = await callClickUpEdge('list_tasks', params) as { tasks?: { id: string; name: string; status?: { status?: string }; url?: string }[] };
          const tasks = data.tasks || [];
          if (!tasks.length) return { success: true, result: 'No tasks found.' };
          return { success: true, result: `Found ${tasks.length} tasks:\n${tasks.map((t: { id: string; name: string; status?: { status?: string }; url?: string }) => `- ${t.name} (${t.status?.status || '?'}) — ${t.url || `https://app.clickup.com/t/${t.id}`}`).join('\n')}` };
        } catch (err) {
          return { success: false, result: `ClickUp error: ${(err as Error).message}` };
        }
      }

      case 'get_clickup_task': {
        try {
          const res = await callClickUpEdge('get_task', { taskId: args.task_id });
          return { success: true, result: JSON.stringify(res) };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'update_clickup_task': {
        try {
          const params: Record<string, unknown> = { taskId: args.task_id };
          if (args.name) params.name = args.name;
          if (args.description) params.description = args.description;
          if (args.priority) params.priority = args.priority;
          const res = await callClickUpEdge('update_task', params);
          return { success: true, result: JSON.stringify(res) };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'delete_clickup_task': {
        try {
          await callClickUpEdge('delete_task', { taskId: args.task_id });
          return { success: true, result: `Task ${args.task_id} deleted.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'set_clickup_task_status': {
        try {
          await callClickUpEdge('set_task_status', { taskId: args.task_id, status: args.status });
          return { success: true, result: `Task ${args.task_id} status set to "${args.status}".` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'set_clickup_due_date': {
        try {
          await callClickUpEdge('set_due_date', { taskId: args.task_id, due_date: args.due_date ?? null });
          return { success: true, result: `Due date ${args.due_date ? 'set' : 'cleared'} on task ${args.task_id}.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'set_clickup_assignees': {
        try {
          await callClickUpEdge('set_assignees', { taskId: args.task_id, add: args.add || [], rem: args.rem || [] });
          return { success: true, result: `Assignees updated on task ${args.task_id}.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'create_clickup_subtask': {
        try {
          const params: Record<string, unknown> = { parentId: args.parent_id, name: args.name };
          if (args.description) params.description = args.description;
          const res = await callClickUpEdge('create_subtask', params) as { id?: string; name?: string; url?: string };
          return { success: true, result: `Subtask created: "${args.name}" — ${res.url || `https://app.clickup.com/t/${res.id}`}` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'create_clickup_comment': {
        try {
          const res = await callClickUpEdge('create_comment', { taskId: args.task_id, comment_text: args.comment_text });
          return { success: true, result: JSON.stringify(res) };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'list_clickup_comments': {
        try {
          const res = await callClickUpEdge('list_comments', { taskId: args.task_id }) as { comments?: { id: string; comment_text?: string; user?: { username?: string } }[] };
          const comments = res.comments || [];
          if (!comments.length) return { success: true, result: 'No comments on this task.' };
          return { success: true, result: `${comments.length} comment(s):\n${comments.map((c: { id: string; comment_text?: string; user?: { username?: string } }) => `- [${c.user?.username || '?'}]: ${(c.comment_text || '').substring(0, 200)} (ID: ${c.id})`).join('\n')}` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'update_clickup_comment': {
        try {
          await callClickUpEdge('update_comment', { commentId: args.comment_id, comment_text: args.comment_text });
          return { success: true, result: `Comment ${args.comment_id} updated.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'delete_clickup_comment': {
        try {
          await callClickUpEdge('delete_comment', { commentId: args.comment_id });
          return { success: true, result: `Comment ${args.comment_id} deleted.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'add_clickup_tag': {
        try {
          await callClickUpEdge('add_tag', { taskId: args.task_id, tag: args.tag });
          return { success: true, result: `Tag "${args.tag}" added to task ${args.task_id}.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'remove_clickup_tag': {
        try {
          await callClickUpEdge('remove_tag', { taskId: args.task_id, tag: args.tag });
          return { success: true, result: `Tag "${args.tag}" removed from task ${args.task_id}.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'create_clickup_checklist': {
        try {
          const res = await callClickUpEdge('create_checklist', { taskId: args.task_id, name: args.name }) as { checklist?: { id?: string } };
          return { success: true, result: `Checklist "${args.name}" created (ID: ${res.checklist?.id || '?'}).` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'create_clickup_checklist_item': {
        try {
          await callClickUpEdge('create_checklist_item', { checklistId: args.checklist_id, name: args.name });
          return { success: true, result: `Checklist item "${args.name}" added.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'update_clickup_checklist_item': {
        try {
          const params: Record<string, unknown> = { checklistId: args.checklist_id, itemId: args.checklist_item_id };
          if (args.name) params.name = args.name;
          if (args.resolved !== undefined) params.resolved = args.resolved;
          await callClickUpEdge('update_checklist_item', params);
          return { success: true, result: `Checklist item updated.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'search_clickup_tasks': {
        try {
          const params: Record<string, unknown> = {};
          if (args.statuses) params.statuses = args.statuses;
          if (args.assignees) params.assignees = args.assignees;
          if (args.tags) params.tags = args.tags;
          if (args.due_date_gt) params.due_date_gt = args.due_date_gt;
          if (args.due_date_lt) params.due_date_lt = args.due_date_lt;
          if (args.include_closed) params.include_closed = true;
          if (args.subtasks) params.subtasks = true;
          const data = await callClickUpEdge('search_tasks', params) as { tasks?: { id: string; name: string; status?: { status?: string }; list?: { name?: string }; url?: string }[] };
          const tasks = data.tasks || [];
          if (!tasks.length) return { success: true, result: 'No tasks found matching filters.' };
          return { success: true, result: `Found ${tasks.length} tasks:\n${tasks.map((t: any) => `- ${t.name} (${t.status?.status || '?'}) [${t.list?.name || '?'}] — ${t.url || `https://app.clickup.com/t/${t.id}`}`).join('\n')}` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'list_clickup_spaces': {
        try {
          const data = await callClickUpEdge('list_spaces') as { spaces?: { id: string; name: string }[] };
          const spaces = data.spaces || [];
          if (!spaces.length) return { success: true, result: 'No spaces found.' };
          return { success: true, result: `Spaces:\n${spaces.map((s: any) => `- ${s.name} (ID: ${s.id})`).join('\n')}` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'list_clickup_lists': {
        try {
          const data = await callClickUpEdge('list_all_lists') as { lists?: { id: string; name: string; space: string; folder: string | null }[]; count?: number };
          const lists = data.lists || [];
          if (!lists.length) return { success: true, result: 'No lists found.' };
          return { success: true, result: `${lists.length} lists:\n${lists.map((l: any) => `- ${l.name} (ID: ${l.id}) — Space: ${l.space}${l.folder ? `, Folder: ${l.folder}` : ''}`).join('\n')}` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'list_clickup_members': {
        try {
          const data = await callClickUpEdge('list_workspace_members') as { members?: { id: number; username: string; email: string }[] };
          const members = data.members || [];
          if (!members.length) return { success: true, result: 'No members found.' };
          return { success: true, result: `Workspace members:\n${members.map((m: any) => `- ${m.username} (${m.email}) — User ID: ${m.id}`).join('\n')}` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'move_clickup_task': {
        try {
          await callClickUpEdge('move_task', { taskId: args.task_id, listId: args.list_id });
          return { success: true, result: `Task ${args.task_id} moved to list ${args.list_id}.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'set_clickup_priority': {
        try {
          await callClickUpEdge('update_task', { taskId: args.task_id, priority: args.priority });
          return { success: true, result: `Priority set to ${args.priority} on task ${args.task_id}.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'start_clickup_timer': {
        try {
          const res = await callClickUpEdge('start_time_entry', { taskId: args.task_id, description: args.description || '' });
          return { success: true, result: `Timer started on task ${args.task_id}. ${JSON.stringify(res)}` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'stop_clickup_timer': {
        try {
          const res = await callClickUpEdge('stop_time_entry');
          return { success: true, result: `Timer stopped. ${JSON.stringify(res)}` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'get_clickup_time_entries': {
        try {
          const params: Record<string, unknown> = {};
          if (args.start_date) params.start_date = args.start_date;
          if (args.end_date) params.end_date = args.end_date;
          const data = await callClickUpEdge('get_time_entries', params);
          return { success: true, result: JSON.stringify(data) };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'get_clickup_custom_fields': {
        try {
          const data = await callClickUpEdge('get_custom_fields', { listId: args.list_id });
          return { success: true, result: JSON.stringify(data) };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'set_clickup_custom_field': {
        try {
          await callClickUpEdge('set_custom_field', { taskId: args.task_id, fieldId: args.field_id, value: args.value });
          return { success: true, result: `Custom field ${args.field_id} set on task ${args.task_id}.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'list_clickup_task_dependencies': {
        try {
          const data = await callClickUpEdge('get_task_dependencies', { taskId: args.task_id });
          return { success: true, result: JSON.stringify(data) };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'add_clickup_dependency': {
        try {
          await callClickUpEdge('add_dependency', { taskId: args.task_id, depends_on: args.depends_on });
          return { success: true, result: `Dependency added: ${args.task_id} depends on ${args.depends_on}.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'delete_clickup_dependency': {
        try {
          await callClickUpEdge('delete_dependency', { taskId: args.task_id, depends_on: args.depends_on });
          return { success: true, result: `Dependency removed.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'delete_clickup_checklist': {
        try {
          await callClickUpEdge('delete_checklist', { checklistId: args.checklist_id });
          return { success: true, result: `Checklist ${args.checklist_id} deleted.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'delete_clickup_checklist_item': {
        try {
          await callClickUpEdge('delete_checklist_item', { checklistId: args.checklist_id, checklistItemId: args.checklist_item_id });
          return { success: true, result: `Checklist item deleted.` };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }
      case 'get_clickup_list_statuses': {
        try {
          const data = await callClickUpEdge('get_list_statuses', { listId: args.list_id });
          return { success: true, result: JSON.stringify(data) };
        } catch (err) { return { success: false, result: `ClickUp error: ${(err as Error).message}` }; }
      }


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
        const body: Record<string, unknown> = { name: args.name, dataType: args.dataType };
        if (args.position !== undefined) body.position = args.position;
        if (args.model) body.model = args.model;
        const res = await callGHL(`/locations/${GHL_LOCATION_ID}/customFields`, 'POST', body, ghlCreds?.apiKey) as { id?: string; customField?: { id?: string }; error?: string };
        if (res.error) return { success: false, result: `GHL error: ${res.error}` };
        return { success: true, result: `Custom field "${args.name}" created (ID: ${res.id || res.customField?.id || 'created'}).` };
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
        if (subs.length === 0) {
          return {
            success: true,
            result: JSON.stringify({
              sub_accounts: active ? [{ id: active, name: 'Primary', active: true }] : [],
              note: 'No sub-accounts configured. Add more in Integrations → Go High Level.',
            }),
          };
        }
        return {
          success: true,
          result: JSON.stringify({
            sub_accounts: subs.map((s) => ({ id: s.id, name: s.name, active: s.id === active })),
          }),
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
        if (ghlCreds) {
          ghlCreds.locationId = match.id;
          if (match.api_key) ghlCreds.apiKey = match.api_key;
        }
        return { success: true, result: `Active GHL sub-account is now "${match.name}" (${match.id}).` };
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
          return { success: false, result: `Memory error: ${e instanceof Error ? e.message : String(e)}` };
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
            const errText = tavilyRes ? await tavilyRes.text().catch(() => '') : 'All attempts failed';
            console.error('[deep_research] Tavily error after retries:', errText);
            if (adminClient && taskRowId) {
              await adminClient.from('research_tasks').update({ status: 'failed' }).eq('id', taskRowId);
            }
            return { success: false, result: `Research search failed: ${tavilyRes?.status ?? 'network error'}` };
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
              model: 'gpt-5.4',
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
              model: 'gpt-5.4',
              messages: [
                { role: 'system', content: 'You extract structured event data from web content. Return only valid JSON arrays.' },
                { role: 'user', content: extractionPrompt },
              ],
              max_tokens: 4096,
              response_format: { type: 'json_object' },
            }),
          });

          if (!extractRes.ok) {
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

      // ============ Higgsfield AI Handlers (delegate to higgsfield edge function) ============
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

IMPORTANT TOOL USAGE RULES:
1. When the user asks you to DO something (send, create, schedule, post, etc.), USE THE APPROPRIATE TOOL.
2. Always confirm the action with the user BEFORE executing destructive or important actions.
3. If a service is not connected, tell the user to connect it in the Integrations page.
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

function getAvailableTools(connMap: MultiConnMap, hasGHLOverride?: boolean): ToolDef[] {
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
    'search_google_drive': 'google-drive',
    'create_google_doc': 'google-drive',
    'create_google_sheet': 'google-drive',
    'read_sheet_data': 'google-drive',
    'append_sheet_rows': 'google-drive',
    'create_google_presentation': 'google-drive',
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
    'ghl_upload_media_file': 'ghl',
    'ghl_delete_media_file': 'ghl',
    'ghl_list_sub_accounts': 'ghl',
    'ghl_set_active_sub_account': 'ghl',
    'ghl_smart_search': 'ghl',
    // GSC / SEO tools
    'gsc_list_sites': 'google-search-console',
    'gsc_query': 'google-search-console',
    'gsc_save_snapshot': 'google-search-console',
    'gsc_compare_snapshots': 'google-search-console',
    'web_search_google': '_always_',
    'save_memory': '_always_',
    'add_standing_order': '_always_',
    'remove_standing_order': '_always_',
    'add_goal': '_always_',
    'update_goal_progress': '_always_',
    'complete_goal': '_always_',
    'deep_research': '_always_',
    'scrape_events': '_always_',
    'list_events': '_always_',
    'create_work_task': '_always_',
    'update_work_task': '_always_',
    'upload_youtube_video': '_always_',
    'higgsfield_generate_image': '_always_',
    'higgsfield_generate_video': '_always_',
    'higgsfield_get_job_status': '_always_',
    'higgsfield_cancel_job': '_always_',
  };

  return ACTION_TOOLS.filter(tool => {
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
  'add_standing_order': 'Setting standing order',
  'remove_standing_order': 'Removing standing order',
  'add_goal': 'Tracking new goal',
  'update_goal_progress': 'Logging goal progress',
  'complete_goal': 'Completing goal',
  'deep_research': 'Researching the web',
  'scrape_events': 'Searching for events',
  'list_events': 'Loading your events',
  'create_work_task': 'Creating work task',
  'update_work_task': 'Updating work task',
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

async function runToolLoop(
  modelConfig: ModelConfig,
  apiKey: string,
  openAIMessages: { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[],
  tools: ToolDef[],
  connMap: MultiConnMap,
  maxIterations = 10,
  onTaskUpdate?: (event: TaskUpdateEvent) => void | Promise<void>,
  userMessage?: string,
  aliasMap?: AliasEntry[],
  userId?: string | null,
  ghlCreds?: { apiKey?: string; locationId?: string; subAccounts?: { id: string; name: string; api_key?: string }[] },
  serviceIntents?: string[],
): Promise<{ role: string; content: string }> {
  let iteration = 0;
  const taskId = crypto.randomUUID();
  let taskCreated = false;

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
        'save_memory', 'add_goal', 'update_goal_progress', 'complete_goal',
        'add_standing_order', 'remove_standing_order',
        'create_work_task', 'update_work_task',
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

      // Apply per-integration soft cap (Tier A only) so multi-intent turns don't starve.
      const perIntegrationCount: Record<string, number> = {};
      const kept: typeof scored = [];
      const overflow: typeof scored = [];
      for (const s of scored) {
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
        `Kept: ${JSON.stringify(distribution)}`,
      );
    }

    const response = await fetch(modelConfig.apiEndpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelConfig.name,
        messages: openAIMessages,
        max_completion_tokens: modelConfig.maxTokens,
        tools: toolsForRequest.length > 0 ? toolsForRequest : undefined,
        tool_choice: toolsForRequest.length > 0 ? 'auto' : undefined,
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
          // Inject user ID for tools that need it
          if (['save_memory', 'deep_research', 'scrape_events', 'list_events', 'upload_youtube_video', 'add_standing_order', 'remove_standing_order', 'add_goal', 'update_goal_progress', 'complete_goal'].includes(tc.function.name) && userId) {
            args.__user_id = userId;
          }
          const stepLabel = TOOL_DISPLAY_NAMES[tc.function.name] || tc.function.name;
          if (onTaskUpdate) await onTaskUpdate({ taskId, title: '', step: stepLabel, status: 'in_progress' });

          console.log(`Executing tool: ${tc.function.name}`, args);
          const result = await executeToolCall(tc.function.name, args, connMap, userMessage, aliasMap, ghlCreds);
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
  const actionKw = ['send', 'create', 'schedule', 'book', 'post', 'draft', 'compose', 'upload'];
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
        model: 'gpt-5.4',
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

    // Native connection discovery + per-user GHL credential resolution
    let GHL_API_KEY_RESOLVED: string | undefined;
    let GHL_LOCATION_ID_RESOLVED: string | undefined;
    let GHL_SUB_ACCOUNTS_RESOLVED: { id: string; name: string; api_key?: string }[] | undefined;

    // Resolve user ID early for credential lookup + native discovery
    const authHeaderForCreds = req.headers.get('Authorization');
    let credUserId: string | null = null;
    if (authHeaderForCreds) {
      try {
        const { createClient: cc } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const anonK = Deno.env.get('SUPABASE_ANON_KEY')!;
        const uc = cc(Deno.env.get('SUPABASE_URL')!, anonK, { global: { headers: { Authorization: authHeaderForCreds } } });
        const { data: { user: credUser } } = await uc.auth.getUser();
        credUserId = credUser?.id || null;
      } catch { /* no auth */ }
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
            parts.push(`HOUSE RULES (these override defaults — never violate):\n${rules.map(r => `- ${r}`).join('\n')}`);
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
            if (typeof meta.api_key === 'string' && meta.api_key) {
              GHL_API_KEY_RESOLVED = meta.api_key as string;
              GHL_LOCATION_ID_RESOLVED = (meta.location_id as string) || undefined;
              if (Array.isArray(meta.sub_accounts)) {
                GHL_SUB_ACCOUNTS_RESOLVED = (meta.sub_accounts as { id: string; name: string; api_key?: string }[])
                  .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string');
              }
            }
          }
        }
      } catch (e) { console.error('GHL credential lookup failed:', e); }
    }

    // No env fallback for GHL — credentials must be per-user from integration_connections.
    // (env GHL_API_KEY / GHL_LOCATION_ID are reserved for non-user contexts only.)

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
        availableTools = getAvailableTools(connMap, !!GHL_API_KEY_RESOLVED);
        console.log(`Available action tools: ${availableTools.length}`);

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
          'auto',
        );
        if (nativeInjection) systemPrompt += nativeInjection;
      } catch (e) {
        console.error('Error in native setup:', e);
      }
    }

    // GoHighLevel data injection (separate from Maton - uses its own API key)
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

      // Add GHL to connected services list
      systemPrompt += `\n- GoHighLevel CRM (contacts, pipelines, opportunities, calendars, conversations, campaigns, workflows)`;

      // If no Maton tools were added, ensure GHL tools are still available
      if (!availableTools.some(t => t.function.name.startsWith('ghl_'))) {
        availableTools = getAvailableTools(connMap, !!GHL_API_KEY_RESOLVED);
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
              detectServiceIntents(messages),
            );

            // Write final content as SSE
            await writer.write(encoder.encode(`data: ${JSON.stringify({
              choices: [{ delta: { content: result.content }, finish_reason: 'stop' }],
            })}\n\n`));
            await writer.write(encoder.encode('data: [DONE]\n\n'));

            // Fire-and-forget: post-turn memory extraction + telemetry
            if (wisdomUserId) {
              extractPostTurnMemories(messages, result.content, wisdomUserId).catch(e =>
                console.error('[PostTurnMemory] Error:', e)
              );
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
