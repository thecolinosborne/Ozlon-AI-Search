import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { text, source_person, source_material, source_type = 'book' } = await req.json();
    if (!text || !source_person) {
      return new Response(JSON.stringify({ error: 'text and source_person are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

    // Step 1: Use AI to break text into discrete knowledge entries
    const extractionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1-2025-04-14',
        messages: [
          {
            role: 'system',
            content: `You are a knowledge extraction engine. Given text about business/entrepreneurship/leadership, extract discrete knowledge entries. Each entry should be a self-contained principle, framework, mental model, strategy, or quote.

Return a JSON array of objects with these fields:
- title: Short name (e.g. "The Value Equation", "Inversion Thinking")
- content: Detailed explanation (2-5 sentences, actionable)
- category: One of: framework, principle, strategy, mental_model, quote, playbook
- domain: One of: marketing, sales, leadership, finance, ops, product, mindset, growth, pricing, hiring, negotiation, decision_making
- tags: Array of 2-5 relevant tags

Extract 5-20 entries depending on input length. Focus on actionable, memorable insights.
Return ONLY the JSON array, no other text.`
          },
          { role: 'user', content: `Source: ${source_person}${source_material ? ` - "${source_material}"` : ''}\n\nText:\n${text}` }
        ],
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (!extractionRes.ok) {
      const errText = await extractionRes.text();
      console.error('Extraction error:', errText);
      throw new Error('Failed to extract knowledge entries');
    }

    const extractionData = await extractionRes.json();
    let rawContent = extractionData.choices?.[0]?.message?.content || '[]';
    // Strip markdown code fences if present
    rawContent = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    let entries: Array<{ title: string; content: string; category: string; domain: string; tags: string[] }>;
    try {
      entries = JSON.parse(rawContent);
    } catch {
      console.error('Failed to parse entries:', rawContent);
      throw new Error('Failed to parse extracted entries');
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return new Response(JSON.stringify({ error: 'No entries extracted' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Extracted ${entries.length} entries from ${source_person}`);

    // Step 2: Create source record
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: sourceData, error: sourceError } = await adminClient
      .from('knowledge_sources')
      .insert({
        user_id: user.id,
        person: source_person,
        title: source_material || `${source_person} - Knowledge`,
        type: source_type,
        entry_count: entries.length,
      })
      .select('id')
      .single();

    if (sourceError) {
      console.error('Source insert error:', sourceError);
      throw new Error('Failed to create knowledge source');
    }

    // Step 3: Generate embeddings for all entries
    const textsToEmbed = entries.map(e => `${e.title}: ${e.content}`);
    const embeddingRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: textsToEmbed,
      }),
    });

    if (!embeddingRes.ok) throw new Error('Failed to generate embeddings');
    const embeddingData = await embeddingRes.json();
    const embeddings = embeddingData.data.map((d: { embedding: number[] }) => d.embedding);

    // Step 4: Insert all entries with embeddings
    const rows = entries.map((entry, i) => ({
      user_id: user.id,
      source_id: sourceData.id,
      source_person,
      source_material: source_material || null,
      category: entry.category,
      domain: entry.domain,
      title: entry.title,
      content: entry.content,
      embedding: JSON.stringify(embeddings[i]),
      tags: entry.tags || [],
    }));

    const { error: insertError } = await adminClient.from('knowledge_entries').insert(rows);
    if (insertError) {
      console.error('Entries insert error:', insertError);
      throw new Error('Failed to insert knowledge entries');
    }

    console.log(`Successfully ingested ${entries.length} entries from ${source_person}`);

    return new Response(JSON.stringify({
      success: true,
      source_id: sourceData.id,
      entries_count: entries.length,
      entries: entries.map(e => ({ title: e.title, category: e.category, domain: e.domain })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Knowledge ingest error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
