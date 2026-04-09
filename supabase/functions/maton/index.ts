import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MATON_BASE_URL = 'https://ctrl.maton.ai';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MATON_API_KEY = Deno.env.get('MATON_API_KEY');
    if (!MATON_API_KEY) {
      throw new Error('MATON_API_KEY is not configured');
    }

    const { action, path, body: reqBody, method: reqMethod } = await req.json();

    let endpoint: string;
    let method = reqMethod || 'GET';
    let fetchBody: string | undefined;

    switch (action) {
      case 'connections':
        endpoint = `${MATON_BASE_URL}/connections`;
        break;
      case 'connectors':
        endpoint = `${MATON_BASE_URL}/connectors`;
        break;
      case 'proxy':
        if (!path) throw new Error('Path is required for proxy action');
        endpoint = `${MATON_BASE_URL}${path}`;
        if (reqBody) {
          fetchBody = JSON.stringify(reqBody);
          if (!reqMethod) method = 'POST';
        }
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const response = await fetch(endpoint, {
      method,
      headers: {
        'Authorization': `Bearer ${MATON_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: fetchBody,
    });

    const data = await response.json();

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
