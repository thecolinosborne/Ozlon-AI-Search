import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MATON_CTRL_URL = 'https://ctrl.maton.ai';
const MATON_GATEWAY_URL = 'https://gateway.maton.ai';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MATON_API_KEY = Deno.env.get('MATON_API_KEY');
    if (!MATON_API_KEY) {
      throw new Error('MATON_API_KEY is not configured');
    }

    const { action, path, body: reqBody, method: reqMethod, connectionId } = await req.json();

    let endpoint: string;
    let method = reqMethod || 'GET';
    let fetchBody: string | undefined;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${MATON_API_KEY}`,
      'Content-Type': 'application/json',
    };

    switch (action) {
      case 'connections':
        endpoint = `${MATON_CTRL_URL}/connections`;
        break;

      case 'gateway':
        // Proxy to the Maton API Gateway (calls connected apps)
        // path should be like: /google-mail/gmail/v1/users/me/messages
        if (!path) throw new Error('Path is required for gateway action');
        endpoint = `${MATON_GATEWAY_URL}${path}`;
        if (connectionId) {
          headers['Maton-Connection'] = connectionId;
        }
        if (reqBody) {
          fetchBody = JSON.stringify(reqBody);
          if (!reqMethod) method = 'POST';
        }
        break;

      case 'proxy':
        // Proxy to the Maton Control API (manage connections)
        if (!path) throw new Error('Path is required for proxy action');
        endpoint = `${MATON_CTRL_URL}${path}`;
        if (reqBody) {
          fetchBody = JSON.stringify(reqBody);
          if (!reqMethod) method = 'POST';
        }
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const response = await fetch(endpoint, { method, headers, body: fetchBody });

    // Handle non-JSON responses (some APIs return plain text)
    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { raw: text };
    }

    if (!response.ok) {
      console.error('Maton API error:', response.status, JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: `Maton API error: ${response.status}`, details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Maton function error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
