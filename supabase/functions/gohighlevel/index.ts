import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

// deno-lint-ignore no-explicit-any
async function tryVaultRead(
  adminClient: any,
  connectionId: string,
  userId: string,
  secretName: string,
): Promise<string | null> {
  try {
    const vaultKey = Deno.env.get("VAULT_ENCRYPTION_KEY");
    if (!vaultKey) return null;
    const keyBytes = new TextEncoder().encode(vaultKey);
    if (keyBytes.length !== 32) {
      console.warn(`[gohighlevel/vault] VAULT_ENCRYPTION_KEY wrong length: ${keyBytes.length}`);
      return null;
    }
    const hexKey = "\\x" + Array.from(keyBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await adminClient.rpc("get_user_secret", {
      _connection_id: connectionId,
      _user_id: userId,
      _secret_name: secretName,
      _encryption_key: hexKey,
    });
    if (error) {
      console.warn(`[gohighlevel/vault] get_user_secret(${secretName}) error:`, error.message);
      return null;
    }
    const plain = typeof data === "string" ? data.trim() : null;
    if (plain && plain.length > 0) {
      console.log(`[gohighlevel/vault] read OK secret=${secretName} len=${plain.length}`);
      const { error: auditErr } = await adminClient
        .from("credential_audit_log")
        .insert({
          user_id: userId,
          connection_id: connectionId,
          provider: "gohighlevel",
          action: "vault_read",
          detail: secretName,
        });
      if (auditErr) console.warn(`[gohighlevel/vault] audit insert failed:`, auditErr.message);
      return plain;
    }
    return null;
  } catch (e) {
    console.warn("[gohighlevel/vault] threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function resolveGHLCredentials(req: Request, payload?: Record<string, unknown>): Promise<{ apiKey: string; locationId: string }> {
  const params = payload?.params && typeof payload.params === 'object'
    ? payload.params as Record<string, unknown>
    : undefined;

  // 1. Explicit request overrides (supports both top-level and nested params).
  // Chat dispatcher forwards the active sub-account pair at the top level.
  const explicitKey =
    readString(payload?.apiKey) ??
    readString(payload?.api_key) ??
    readString(params?.apiKey) ??
    readString(params?.api_key);
  const explicitLoc =
    readString(payload?.locationId) ??
    readString(payload?.location_id) ??
    readString(params?.locationId) ??
    readString(params?.location_id);

  if (explicitKey && explicitLoc) {
    console.log(`[gohighlevel/auth] using explicit request override for location ${explicitLoc}`);
    return { apiKey: explicitKey, locationId: explicitLoc };
  }

  // 2. Per-user lookup (vault-first, metadata fallback)
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const adminClient = createClient(supabaseUrl, serviceKey);
        const { data: connections } = await adminClient
          .from('integration_connections')
          .select('id, metadata')
          .eq('user_id', user.id)
          .eq('provider', 'gohighlevel')
          .eq('status', 'connected');

        for (const conn of connections || []) {
          if (!conn?.id) continue;
          const meta = (conn.metadata as Record<string, unknown>) || {};
          const topLevelKey =
            (await tryVaultRead(adminClient, conn.id, user.id, 'api_key')) ||
            readString(meta.api_key) ||
            '';
          const topLevelLocation =
            (await tryVaultRead(adminClient, conn.id, user.id, 'location_id')) ||
            readString(meta.location_id) ||
            '';
          const allSubAccounts = Array.isArray(meta.sub_accounts)
            ? (meta.sub_accounts as Record<string, unknown>[])
            : [];
          // Sub-accounts marked `disabled: true` are remembered but not auto-selected.
          // They remain usable when explicitly requested by location_id.
          const subAccounts = allSubAccounts.filter((sub) => sub?.disabled !== true);
          const matchingSub = explicitLoc
            ? allSubAccounts.find((sub) => readString(sub?.id) === explicitLoc)
            : undefined;
          const matchingSubKey = matchingSub ? readString(matchingSub.api_key) : undefined;
          const fallbackSub = subAccounts.find((sub) => readString(sub?.api_key));
          const defaultSub = topLevelLocation
            ? subAccounts.find((sub) => readString(sub?.id) === topLevelLocation)
            : undefined;
          const defaultSubKey = defaultSub ? readString(defaultSub.api_key) : undefined;

          // Explicit location requested: prefer its own token, then the top-level token.
          if (explicitLoc) {
            const candidateKey = explicitKey || matchingSubKey || topLevelKey;
            if (candidateKey) {
              console.log(`[gohighlevel/auth] resolved requested location ${explicitLoc} from stored connection`);
              return { apiKey: candidateKey, locationId: explicitLoc };
            }
            continue;
          }

          const candidateLocation = topLevelLocation || readString(fallbackSub?.id) || explicitLoc || '';
          const candidateKey = explicitKey || defaultSubKey || topLevelKey || readString(fallbackSub?.api_key) || '';
          if (candidateKey && candidateLocation) {
            if (defaultSubKey && topLevelLocation) {
              console.log(`[gohighlevel/auth] using sub-account token for default location ${topLevelLocation}`);
            }
            return { apiKey: candidateKey, locationId: candidateLocation };
          }
        }
      }
    } catch { /* fall through */ }
  }

  // No env fallback for authenticated user actions — credentials must be per-user.
  throw new Error('GoHighLevel not connected. Add your API key in Integrations → Go High Level.');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { action, path, body: reqBody, method: reqMethod, params } = payload;

    const { apiKey: GHL_API_KEY, locationId: GHL_LOCATION_ID } = await resolveGHLCredentials(req, payload);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    };

    let endpoint: string;
    let method = reqMethod || 'GET';
    let fetchBody: string | undefined;

    switch (action) {
      // ============ CONTACTS ============
      case 'list_contacts': {
        const limit = params?.limit || 20;
        const query = params?.query ? `&query=${encodeURIComponent(params.query)}` : '';
        endpoint = `${GHL_BASE_URL}/contacts/?locationId=${GHL_LOCATION_ID}&limit=${limit}${query}`;
        break;
      }
      case 'get_contact': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}`;
        break;
      }
      case 'create_contact': {
        endpoint = `${GHL_BASE_URL}/contacts/`;
        method = 'POST';
        fetchBody = JSON.stringify({ ...reqBody, locationId: GHL_LOCATION_ID });
        break;
      }
      case 'update_contact': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}`;
        method = 'PUT';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'search_contacts': {
        endpoint = `${GHL_BASE_URL}/contacts/search`;
        method = 'POST'; // V2 uses POST for search (was GET before, now uses POST with body)
        fetchBody = JSON.stringify({ locationId: GHL_LOCATION_ID, ...reqBody });
        break;
      }

      // ============ OPPORTUNITIES / PIPELINES ============
      case 'list_pipelines': {
        endpoint = `${GHL_BASE_URL}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`;
        break;
      }
      case 'list_opportunities': {
        const pipelineId = params?.pipelineId || '';
        const limit = params?.limit || 20;
        endpoint = `${GHL_BASE_URL}/opportunities/search?locationId=${GHL_LOCATION_ID}&pipelineId=${pipelineId}&limit=${limit}`;
        break;
      }
      case 'get_opportunity': {
        if (!params?.opportunityId) throw new Error('opportunityId required');
        endpoint = `${GHL_BASE_URL}/opportunities/${params.opportunityId}`;
        break;
      }
      case 'create_opportunity': {
        endpoint = `${GHL_BASE_URL}/opportunities/`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'update_opportunity': {
        if (!params?.opportunityId) throw new Error('opportunityId required');
        endpoint = `${GHL_BASE_URL}/opportunities/${params.opportunityId}`;
        method = 'PUT';
        fetchBody = JSON.stringify(reqBody);
        break;
      }

      // ============ CALENDARS ============
      case 'list_calendars': {
        endpoint = `${GHL_BASE_URL}/calendars/?locationId=${GHL_LOCATION_ID}`;
        break;
      }
      case 'get_calendar_events': {
        if (!params?.calendarId) throw new Error('calendarId required');
        const startTime = params?.startTime || new Date().toISOString();
        const endTime = params?.endTime || new Date(Date.now() + 7 * 86400000).toISOString();
        endpoint = `${GHL_BASE_URL}/calendars/events?locationId=${GHL_LOCATION_ID}&calendarId=${params.calendarId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
        break;
      }
      case 'get_free_slots': {
        if (!params?.calendarId) throw new Error('calendarId required');
        const start = params?.startDate || new Date().toISOString().split('T')[0];
        const end = params?.endDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        endpoint = `${GHL_BASE_URL}/calendars/${params.calendarId}/free-slots?startDate=${start}&endDate=${end}`;
        break;
      }
      case 'create_appointment': {
        if (!params?.calendarId) throw new Error('calendarId required');
        endpoint = `${GHL_BASE_URL}/calendars/events/appointments`;
        method = 'POST';
        fetchBody = JSON.stringify({ calendarId: params.calendarId, ...reqBody });
        break;
      }

      // ============ CONVERSATIONS ============
      case 'list_conversations': {
        const limit = params?.limit || 20;
        endpoint = `${GHL_BASE_URL}/conversations/search?locationId=${GHL_LOCATION_ID}&limit=${limit}`;
        break;
      }
      case 'get_conversation': {
        if (!params?.conversationId) throw new Error('conversationId required');
        endpoint = `${GHL_BASE_URL}/conversations/${params.conversationId}`;
        break;
      }
      case 'get_conversation_messages': {
        if (!params?.conversationId) throw new Error('conversationId required');
        endpoint = `${GHL_BASE_URL}/conversations/${params.conversationId}/messages`;
        break;
      }
      case 'send_message': {
        endpoint = `${GHL_BASE_URL}/conversations/messages`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'update_conversation': {
        if (!params?.conversationId) throw new Error('conversationId required');
        endpoint = `${GHL_BASE_URL}/conversations/${params.conversationId}`;
        method = 'PUT';
        const { conversationId: _ignore, ...rest } = (params as Record<string, unknown>);
        fetchBody = JSON.stringify(rest);
        break;
      }

      // ============ CAMPAIGNS ============
      case 'list_campaigns': {
        endpoint = `${GHL_BASE_URL}/campaigns/?locationId=${GHL_LOCATION_ID}`;
        break;
      }

      // ============ WORKFLOWS ============
      case 'list_workflows': {
        endpoint = `${GHL_BASE_URL}/workflows/?locationId=${GHL_LOCATION_ID}`;
        break;
      }

      // ============ INVOICES ============
      case 'list_invoices': {
        const limit = params?.limit || 20;
        const altId = GHL_LOCATION_ID;
        endpoint = `${GHL_BASE_URL}/invoices/?altId=${altId}&altType=location&limit=${limit}`;
        break;
      }
      case 'get_invoice': {
        if (!params?.invoiceId) throw new Error('invoiceId required');
        endpoint = `${GHL_BASE_URL}/invoices/${params.invoiceId}`;
        break;
      }
      case 'create_invoice': {
        endpoint = `${GHL_BASE_URL}/invoices/`;
        method = 'POST';
        fetchBody = JSON.stringify({ altId: GHL_LOCATION_ID, altType: 'location', ...reqBody });
        break;
      }

      // ============ PAYMENTS / ORDERS ============
      case 'list_orders': {
        endpoint = `${GHL_BASE_URL}/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&limit=${params?.limit || 20}`;
        break;
      }
      case 'list_transactions': {
        endpoint = `${GHL_BASE_URL}/payments/transactions?altId=${GHL_LOCATION_ID}&altType=location&limit=${params?.limit || 20}`;
        break;
      }

      // ============ TAGS ============
      case 'list_tags': {
        endpoint = `${GHL_BASE_URL}/locations/${GHL_LOCATION_ID}/tags`;
        break;
      }
      case 'add_tag': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}/tags`;
        method = 'POST';
        fetchBody = JSON.stringify({ tags: reqBody?.tags || [] });
        break;
      }

      // ============ CUSTOM VALUES ============
      case 'list_custom_values': {
        endpoint = `${GHL_BASE_URL}/locations/${GHL_LOCATION_ID}/customValues`;
        break;
      }

      // ============ CUSTOM FIELDS ============
      case 'list_custom_fields': {
        const ot = (params?.objectType as string | undefined);
        const qs = ot ? `?model=${encodeURIComponent(ot)}` : '';
        endpoint = `${GHL_BASE_URL}/locations/${GHL_LOCATION_ID}/customFields${qs}`;
        break;
      }
      case 'get_custom_field': {
        if (!params?.customFieldId) throw new Error('customFieldId required');
        endpoint = `${GHL_BASE_URL}/locations/${GHL_LOCATION_ID}/customFields/${params.customFieldId}`;
        break;
      }
      case 'create_custom_field': {
        endpoint = `${GHL_BASE_URL}/locations/${GHL_LOCATION_ID}/customFields`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'update_custom_field': {
        if (!params?.customFieldId) throw new Error('customFieldId required');
        endpoint = `${GHL_BASE_URL}/locations/${GHL_LOCATION_ID}/customFields/${params.customFieldId}`;
        method = 'PUT';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'delete_custom_field': {
        if (!params?.customFieldId) throw new Error('customFieldId required');
        endpoint = `${GHL_BASE_URL}/locations/${GHL_LOCATION_ID}/customFields/${params.customFieldId}`;
        method = 'DELETE';
        break;
      }

      // ============ USERS ============
      case 'list_users': {
        endpoint = `${GHL_BASE_URL}/users/?locationId=${GHL_LOCATION_ID}`;
        break;
      }

      // ============ FORMS ============
      case 'list_forms': {
        endpoint = `${GHL_BASE_URL}/forms/?locationId=${GHL_LOCATION_ID}`;
        break;
      }
      case 'get_form_submissions': {
        if (!params?.formId) throw new Error('formId required');
        endpoint = `${GHL_BASE_URL}/forms/submissions?locationId=${GHL_LOCATION_ID}&formId=${params.formId}&limit=${params?.limit || 20}`;
        break;
      }

      // ============ FUNNELS ============
      case 'list_funnels': {
        endpoint = `${GHL_BASE_URL}/funnels/funnel/list?locationId=${GHL_LOCATION_ID}`;
        break;
      }

      // ============ DELETE CONTACT ============
      case 'delete_contact': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}`;
        method = 'DELETE';
        break;
      }

      // ============ CONTACT NOTES ============
      case 'list_contact_notes': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}/notes`;
        break;
      }
      case 'add_contact_note': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}/notes`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }

      // ============ CONTACT TASKS ============
      case 'list_contact_tasks': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}/tasks`;
        break;
      }
      case 'add_contact_task': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}/tasks`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }

      // ============ REMOVE TAGS ============
      case 'remove_tags': {
        if (!params?.contactId) throw new Error('contactId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}/tags`;
        method = 'DELETE';
        fetchBody = JSON.stringify({ tags: reqBody?.tags || [] });
        break;
      }

      // ============ CANCEL APPOINTMENT ============
      case 'cancel_appointment': {
        if (!params?.eventId) throw new Error('eventId required');
        endpoint = `${GHL_BASE_URL}/calendars/events/appointments/${params.eventId}`;
        method = 'DELETE';
        break;
      }

      // ============ TRIGGER WORKFLOW ============
      case 'trigger_workflow': {
        if (!params?.contactId || !params?.workflowId) throw new Error('contactId and workflowId required');
        endpoint = `${GHL_BASE_URL}/contacts/${params.contactId}/workflow/${params.workflowId}`;
        method = 'POST';
        fetchBody = reqBody ? JSON.stringify(reqBody) : undefined;
        break;
      }

      // ============ SOCIAL PLANNER ============
      case 'list_social_accounts': {
        endpoint = `${GHL_BASE_URL}/social-media-posting/${GHL_LOCATION_ID}/accounts`;
        break;
      }
      case 'list_social_posts': {
        // GHL requires POST with a filter body. Defaults pull recent posts across all accounts.
        endpoint = `${GHL_BASE_URL}/social-media-posting/${GHL_LOCATION_ID}/posts/list`;
        method = 'POST';
        const socialBody = {
          type: (reqBody as Record<string, unknown>)?.type ?? 'all', // all | scheduled | posted | failed | in_review
          accountIds: (reqBody as Record<string, unknown>)?.accountIds ?? [],
          skip: (reqBody as Record<string, unknown>)?.skip ?? 0,
          limit: (reqBody as Record<string, unknown>)?.limit ?? (params?.limit as number | undefined) ?? 20,
          ...(reqBody as Record<string, unknown> | undefined),
        };
        fetchBody = JSON.stringify(socialBody);
        break;
      }
      case 'get_social_post': {
        if (!params?.postId) throw new Error('postId required');
        endpoint = `${GHL_BASE_URL}/social-media-posting/${GHL_LOCATION_ID}/posts/${params.postId}`;
        break;
      }
      case 'create_social_post': {
        endpoint = `${GHL_BASE_URL}/social-media-posting/${GHL_LOCATION_ID}/posts`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'edit_social_post': {
        if (!params?.postId) throw new Error('postId required');
        endpoint = `${GHL_BASE_URL}/social-media-posting/${GHL_LOCATION_ID}/posts/${params.postId}`;
        method = 'PUT';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'delete_social_post': {
        if (!params?.postId) throw new Error('postId required');
        endpoint = `${GHL_BASE_URL}/social-media-posting/${GHL_LOCATION_ID}/posts/${params.postId}`;
        method = 'DELETE';
        break;
      }

      // ============ PRODUCTS ============
      case 'list_products': {
        endpoint = `${GHL_BASE_URL}/products/?locationId=${GHL_LOCATION_ID}&limit=${params?.limit || 20}`;
        break;
      }
      case 'get_product': {
        if (!params?.productId) throw new Error('productId required');
        endpoint = `${GHL_BASE_URL}/products/${params.productId}`;
        break;
      }
      case 'create_product': {
        endpoint = `${GHL_BASE_URL}/products/`;
        method = 'POST';
        fetchBody = JSON.stringify({ locationId: GHL_LOCATION_ID, ...reqBody });
        break;
      }
      case 'update_product': {
        if (!params?.productId) throw new Error('productId required');
        endpoint = `${GHL_BASE_URL}/products/${params.productId}`;
        method = 'PUT';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'delete_product': {
        if (!params?.productId) throw new Error('productId required');
        endpoint = `${GHL_BASE_URL}/products/${params.productId}`;
        method = 'DELETE';
        break;
      }

      // ============ COURSES ============
      case 'list_courses': {
        endpoint = `${GHL_BASE_URL}/courses/?locationId=${GHL_LOCATION_ID}`;
        break;
      }
      case 'import_courses': {
        endpoint = `${GHL_BASE_URL}/courses/courses-exporter/public/import`;
        method = 'POST';
        fetchBody = JSON.stringify({ locationId: GHL_LOCATION_ID, ...reqBody });
        break;
      }

      // ============ SURVEYS ============
      case 'list_surveys': {
        endpoint = `${GHL_BASE_URL}/surveys/?locationId=${GHL_LOCATION_ID}`;
        break;
      }
      case 'get_survey_submissions': {
        if (!params?.surveyId) throw new Error('surveyId required');
        endpoint = `${GHL_BASE_URL}/surveys/submissions?locationId=${GHL_LOCATION_ID}&surveyId=${params.surveyId}&limit=${params?.limit || 20}`;
        break;
      }

      // ============ BLOGS ============
      case 'list_blog_sites': {
        // Discover blog sites for the location. blogId from here is required for list_blog_posts.
        const blogLimit = (params?.limit as number | undefined) || 20;
        const blogSkip = (params?.skip as number | undefined) || 0;
        endpoint = `${GHL_BASE_URL}/blogs/site/all?locationId=${GHL_LOCATION_ID}&limit=${blogLimit}&skip=${blogSkip}`;
        break;
      }
      case 'list_blog_posts': {
        // GHL requires blogId. If not provided, return a helpful error so the AI calls list_blog_sites first.
        if (!params?.blogId) {
          throw new Error('blogId required. Call list_blog_sites first to discover blog IDs for this location.');
        }
        const blogLimit = (params?.limit as number | undefined) || 20;
        const blogSkip = (params?.skip as number | undefined) || 0;
        endpoint = `${GHL_BASE_URL}/blogs/posts/all?locationId=${GHL_LOCATION_ID}&blogId=${params.blogId}&limit=${blogLimit}&offset=${blogSkip}`;
        break;
      }
      case 'get_blog_post': {
        if (!params?.postId) throw new Error('postId required');
        endpoint = `${GHL_BASE_URL}/blogs/posts/${params.postId}`;
        break;
      }
      case 'create_blog_post': {
        // blogId is required by GHL to create a post under a specific blog site.
        if (!reqBody || !(reqBody as Record<string, unknown>).blogId) {
          throw new Error('blogId required in body. Call list_blog_sites first to discover blog IDs.');
        }
        endpoint = `${GHL_BASE_URL}/blogs/posts`;
        method = 'POST';
        fetchBody = JSON.stringify({ locationId: GHL_LOCATION_ID, ...reqBody });
        break;
      }

      // ============ MEDIA ============
      case 'list_media_files': {
        endpoint = `${GHL_BASE_URL}/medias/files?altId=${GHL_LOCATION_ID}&altType=location&limit=${params?.limit || 50}`;
        break;
      }
      case 'upload_media_file': {
        // Upload a file to the GHL Media Library.
        // Accepts EITHER:
        //   - { sourceUrl: "https://...", fileName?: "name.jpg" }   → server fetches the URL
        //   - { fileBase64: "<base64>", fileName: "name.jpg", mimeType?: "image/jpeg" }
        // Returns the GHL media object (incl. fileId / url) so it can be attached to a social post.
        const b = (reqBody || {}) as Record<string, unknown>;
        const sourceUrl = typeof b.sourceUrl === 'string' ? b.sourceUrl : undefined;
        const fileBase64 = typeof b.fileBase64 === 'string' ? b.fileBase64 : undefined;
        let fileName = typeof b.fileName === 'string' ? b.fileName : undefined;
        let mimeType = typeof b.mimeType === 'string' ? b.mimeType : undefined;

        if (!sourceUrl && !fileBase64) {
          throw new Error('upload_media_file requires either sourceUrl or fileBase64');
        }

        let blob: Blob;
        if (sourceUrl) {
          const fetched = await fetch(sourceUrl);
          if (!fetched.ok) throw new Error(`Failed to fetch sourceUrl (${fetched.status})`);
          const buf = await fetched.arrayBuffer();
          mimeType = mimeType || fetched.headers.get('content-type') || 'application/octet-stream';
          if (!fileName) {
            const u = new URL(sourceUrl);
            fileName = u.pathname.split('/').pop() || `upload-${Date.now()}`;
          }
          blob = new Blob([buf], { type: mimeType });
        } else {
          if (!fileName) throw new Error('fileName required when using fileBase64');
          mimeType = mimeType || 'application/octet-stream';
          const bin = Uint8Array.from(atob(fileBase64!), (c) => c.charCodeAt(0));
          blob = new Blob([bin], { type: mimeType });
        }

        const form = new FormData();
        form.append('file', blob, fileName);
        form.append('hosted', 'false');
        form.append('name', fileName);

        // Multipart: must NOT pre-set Content-Type — fetch sets the boundary.
        const uploadRes = await fetch(
          `${GHL_BASE_URL}/medias/upload-file?altId=${GHL_LOCATION_ID}&altType=location`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GHL_API_KEY}`,
              'Version': '2021-07-28',
            },
            body: form,
          },
        );
        const uploadJson = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          console.error('GHL media upload failed:', uploadRes.status, uploadJson);
          return new Response(
            JSON.stringify({ error: `GHL media upload failed: ${uploadRes.status}`, details: uploadJson }),
            { status: uploadRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify(uploadJson), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============ COMPANIES ============
      case 'list_companies': {
        endpoint = `${GHL_BASE_URL}/companies/?locationId=${GHL_LOCATION_ID}&limit=${params?.limit || 20}`;
        break;
      }
      case 'get_company': {
        if (!params?.companyId) throw new Error('companyId required');
        endpoint = `${GHL_BASE_URL}/companies/${params.companyId}`;
        break;
      }

      // ============ LINKS ============
      case 'list_links': {
        endpoint = `${GHL_BASE_URL}/links/?locationId=${GHL_LOCATION_ID}`;
        break;
      }
      case 'create_link': {
        endpoint = `${GHL_BASE_URL}/links/`;
        method = 'POST';
        fetchBody = JSON.stringify({ locationId: GHL_LOCATION_ID, ...reqBody });
        break;
      }
      case 'update_link': {
        if (!params?.linkId) throw new Error('linkId required');
        endpoint = `${GHL_BASE_URL}/links/${params.linkId}`;
        method = 'PUT';
        fetchBody = JSON.stringify(reqBody);
        break;
      }

      // ============ BUSINESSES ============
      case 'list_businesses': {
        endpoint = `${GHL_BASE_URL}/businesses/?locationId=${GHL_LOCATION_ID}`;
        break;
      }
      case 'get_business': {
        if (!params?.businessId) throw new Error('businessId required');
        endpoint = `${GHL_BASE_URL}/businesses/${params.businessId}`;
        break;
      }

      // ============ TOKEN INTROSPECTION (no GHL upstream needed) ============
      // Decodes the Private Integration JWT to extract granted scopes, then
      // pings GET /locations/{id} to confirm the token actually has access to
      // that specific location. Returns a structured verification receipt.
      case 'verify_token': {
        // For verify_token we accept apiKey + locationId from `params` directly
        // (the dashboard sends them this way before the connection is saved).
        const tok = (params?.apiKey as string | undefined) || GHL_API_KEY;
        const loc = (params?.locationId as string | undefined) || GHL_LOCATION_ID;

        // ---- Decode JWT for embedded scopes ----
        let scopes: string[] = [];
        let companyId: string | undefined;
        let tokenLocationId: string | undefined;
        try {
          const parts = (tok || '').split('.');
          if (parts.length >= 2) {
            let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
            const oauthMeta = (payload.oauthMeta as Record<string, unknown> | undefined) || {};
            const rawScopes = oauthMeta.scopes ?? payload.scopes ?? payload.scope;
            if (Array.isArray(rawScopes)) {
              scopes = rawScopes.filter((s): s is string => typeof s === 'string');
            } else if (typeof rawScopes === 'string' && rawScopes.trim()) {
              scopes = rawScopes.trim().split(/\s+/);
            }
            if (typeof payload.company_id === 'string') companyId = payload.company_id;
            if (typeof payload.location_id === 'string') tokenLocationId = payload.location_id;
            if (!tokenLocationId && typeof oauthMeta.locationId === 'string') {
              tokenLocationId = oauthMeta.locationId as string;
            }
          }
        } catch (e) {
          console.warn('[gohighlevel/verify_token] JWT decode failed:', e);
        }

        // ---- Confirm location access by hitting /locations/{id} ----
        // (probe-based scope detection happens after this, only if JWT had no scopes)
        let locationName: string | undefined;
        let locationOk = false;
        let locationStatus = 0;
        let locationErr: string | undefined;
        if (loc && tok) {
          try {
            const r = await fetch(`${GHL_BASE_URL}/locations/${loc}`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${tok}`,
                'Version': '2021-07-28',
              },
            });
            locationStatus = r.status;
            const txt = await r.text();
            let j: Record<string, unknown> = {};
            try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
            if (r.ok) {
              locationOk = true;
              const locObj = (j.location as Record<string, unknown> | undefined) || j;
              if (locObj && typeof locObj.name === 'string') locationName = locObj.name as string;
              if (!companyId && locObj && typeof locObj.companyId === 'string') {
                companyId = locObj.companyId as string;
              }
            } else {
              locationErr = typeof j === 'string' ? j : (txt?.slice(0, 400) || `HTTP ${r.status}`);
            }
          } catch (e) {
            locationErr = e instanceof Error ? e.message : String(e);
          }
        }

        const ok = !!tok && !!loc && locationOk;
        const result = {
          ok,
          scopes,
          locationName,
          locationId: loc,
          companyId,
          tokenLocationId,
          location_check: {
            ok: locationOk,
            status: locationStatus,
            error: locationErr,
          },
          hint: !tok
            ? 'Missing API token.'
            : !loc
              ? 'Missing Location ID.'
              : !locationOk
                ? (locationStatus === 401 || locationStatus === 403
                    ? "Token does not have access to this Location ID. Re-create the Private Integration token in this sub-account in GHL, or double-check the Location ID."
                    : `Could not verify location (HTTP ${locationStatus}).`)
                : scopes.length === 0
                  ? 'Connected, but no scopes were detectable in the token. Make sure you used a Private Integration token (not a legacy v1 API key).'
                  : `Verified — ${scopes.length} scope${scopes.length === 1 ? '' : 's'} detected.`,
        };

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============ GENERIC PROXY ============
      case 'proxy': {
        if (!path) throw new Error('Path required for proxy action');
        endpoint = `${GHL_BASE_URL}${path}`;
        if (reqBody) {
          fetchBody = JSON.stringify(reqBody);
          if (!reqMethod) method = 'POST';
        }
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    console.log(`GHL API: ${method} ${endpoint}`);

    const response = await fetch(endpoint, { method, headers, body: fetchBody });

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { raw: text };
    }

    if (!response.ok) {
      console.error('GHL API error:', response.status, JSON.stringify(data));
      // Categorize for downstream AI consumption (verbatim message preserved)
      const status = response.status;
      let category = 'tooling_gap';
      let minimum_fix = 'Review tool arguments and retry.';
      if (status === 401 || status === 403) {
        category = 'auth_gap';
        minimum_fix = 'Reconnect the GoHighLevel sub-account or refresh the API key.';
      } else if (status === 404) {
        category = 'schema_gap';
        minimum_fix = 'Check the resource ID, objectType, or endpoint path.';
      } else if (status === 400 || status === 422) {
        category = 'schema_gap';
        minimum_fix = 'Fix the payload — required field missing or invalid value.';
      } else if (status === 429) {
        category = 'policy_block';
        minimum_fix = 'Rate limited by GoHighLevel — wait and retry.';
      } else if (status >= 500) {
        category = 'upstream_error';
        minimum_fix = 'GoHighLevel is failing — retry later.';
      }
      const verbatim = typeof data === 'string' ? data : JSON.stringify(data);
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            category,
            ghl_status: status,
            ghl_message: verbatim,
            minimum_fix,
          },
          details: data,
        }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('GHL function error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
