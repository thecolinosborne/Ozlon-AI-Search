import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GHL_API_KEY = Deno.env.get('GHL_API_KEY');
    const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');

    if (!GHL_API_KEY) {
      throw new Error('GHL_API_KEY is not configured');
    }

    const { action, path, body: reqBody, method: reqMethod, params } = await req.json();

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
        endpoint = `${GHL_BASE_URL}/locations/${GHL_LOCATION_ID}/customFields`;
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
      return new Response(
        JSON.stringify({ error: `GHL API error: ${response.status}`, details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
