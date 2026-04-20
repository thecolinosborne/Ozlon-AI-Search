import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// KNOWLEDGE FETCH URL
// Scrapes a public URL via Firecrawl, then pipes content into knowledge-ingest
// ============================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      url,
      source_person,
      source_material,
      source_type = 'article',
      extract_memories = true,
      generate_reflection = true,
    } = await req.json();

    if (!url || !source_person) {
      return new Response(JSON.stringify({ error: 'url and source_person are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Scrape via Firecrawl v2
    const scrapeRes = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });

    const scrapeData = await scrapeRes.json();
    if (!scrapeRes.ok) {
      return new Response(JSON.stringify({ error: `Firecrawl failed: ${scrapeData?.error || scrapeRes.statusText}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const markdown: string =
      scrapeData?.data?.markdown ||
      scrapeData?.markdown ||
      '';
    const fetchedTitle: string =
      scrapeData?.data?.metadata?.title ||
      scrapeData?.metadata?.title ||
      source_material ||
      url;

    if (!markdown || markdown.length < 100) {
      return new Response(JSON.stringify({ error: 'Insufficient content scraped from URL' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pipe into knowledge-ingest
    const ingestRes = await fetch(`${supabaseUrl}/functions/v1/knowledge-ingest`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: markdown.slice(0, 50000),
        source_person,
        source_material: source_material || fetchedTitle,
        source_type,
        extract_memories,
        generate_reflection,
      }),
    });

    const ingestData = await ingestRes.json();
    if (!ingestRes.ok) {
      return new Response(JSON.stringify({ error: ingestData?.error || 'Ingest failed' }), {
        status: ingestRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      ...ingestData,
      scraped_url: url,
      scraped_title: fetchedTitle,
      scraped_chars: markdown.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('knowledge-fetch-url error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
