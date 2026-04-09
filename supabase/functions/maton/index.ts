import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MATON_BASE_URL = 'https://api.maton.ai';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MATON_API_KEY = Deno.env.get('MATON_API_KEY');
    if (!MATON_API_KEY) {
      throw new Error('MATON_API_KEY is not configured');
    }

    const { action, path, body: reqBody } = await req.json();

    // Route based on action
    let endpoint: string;
    let method = 'GET';
    let fetchBody: string | undefined;

    switch (action) {
      case 'status':
        // Check connection status / list available connectors
        endpoint = `${MATON_BASE_URL}/v1/connectors`;
        break;
      case 'connections':
        // List active connections
        endpoint = `${MATON_BASE_URL}/v1/connections`;
        break;
      case 'proxy':
        // Proxy a request to any Maton endpoint
        if (!path) throw new Error('Path is required for proxy action');
        endpoint = `${MATON_BASE_URL}${path}`;
        method = reqBody ? 'POST' : 'GET';
        fetchBody = reqBody ? JSON.stringify(reqBody) : undefined;
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
