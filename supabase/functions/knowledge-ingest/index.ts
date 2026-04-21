import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// KNOWLEDGE INGEST - Enhanced with memory extraction + reflection
// Accepts: text, title, source metadata
// Outputs: knowledge entries + optional wisdom memories + optional reflection
// ============================================================

async function generateEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) throw new Error('Failed to generate embeddings');
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

async function callAI(_apiKey: string, systemPrompt: string, userPrompt: string, maxTokens = 4096): Promise<string> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableKey) throw new Error('LOVABLE_API_KEY not configured');
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      max_completion_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('AI extraction failed:', res.status, errText);
    throw new Error(`AI extraction failed: ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '[]';
}

function parseJSON<T>(raw: string): T {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
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

    const {
      text,
      source_person,
      source_material,
      source_type = 'book',
      extract_memories = false,
      generate_reflection = false,
    } = await req.json();

    if (!text || !source_person) {
      return new Response(JSON.stringify({ error: 'text and source_person are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Step 1: Extract knowledge entries via AI
    const extractionPrompt = `You are a knowledge extraction engine. Given text about business/entrepreneurship/leadership, extract discrete knowledge entries.

Return a JSON array of objects with:
- title: Short name (e.g. "The Value Equation")
- content: Detailed explanation (2-5 sentences, actionable)
- category: One of: framework, principle, strategy, mental_model, quote, playbook
- domain: One of: marketing, sales, leadership, finance, ops, product, mindset, growth, pricing, hiring, negotiation, decision_making
- tags: Array of 2-5 relevant tags

Extract 5-20 entries depending on input length. Focus on actionable, memorable insights.
Return ONLY the JSON array.`;

    const rawEntries = await callAI(OPENAI_API_KEY, extractionPrompt, `Source: ${source_person}${source_material ? ` - "${source_material}"` : ''}\n\nText:\n${text}`);
    
    let entries: Array<{ title: string; content: string; category: string; domain: string; tags: string[] }>;
    try {
      entries = parseJSON(rawEntries);
    } catch {
      console.error('Failed to parse entries:', rawEntries);
      throw new Error('Failed to parse extracted entries');
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return new Response(JSON.stringify({ error: 'No entries extracted' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Extracted ${entries.length} entries from ${source_person}`);

    // Step 2: Create source record
    const { data: sourceData, error: sourceError } = await adminClient
      .from('knowledge_sources')
      .insert({ user_id: user.id, person: source_person, title: source_material || `${source_person} - Knowledge`, type: source_type, entry_count: entries.length })
      .select('id')
      .single();
    if (sourceError) throw new Error('Failed to create knowledge source');

    // Step 3: Generate embeddings for all entries
    const textsToEmbed = entries.map(e => `${e.title}: ${e.content}`);
    const embeddings = await generateEmbeddings(textsToEmbed, OPENAI_API_KEY);

    // Step 4: Insert knowledge entries
    const rows = entries.map((entry, i) => ({
      user_id: user.id, source_id: sourceData.id, source_person,
      source_material: source_material || null,
      category: entry.category, domain: entry.domain,
      title: entry.title, content: entry.content,
      embedding: JSON.stringify(embeddings[i]),
      tags: entry.tags || [],
    }));
    const { error: insertError } = await adminClient.from('knowledge_entries').insert(rows);
    if (insertError) throw new Error('Failed to insert knowledge entries');

    const result: Record<string, unknown> = {
      success: true,
      source_id: sourceData.id,
      entries_count: entries.length,
      entries: entries.map(e => ({ title: e.title, category: e.category, domain: e.domain })),
    };

    // Step 5: Optionally extract durable memory candidates
    if (extract_memories) {
      try {
        const memoryPrompt = `You extract durable personal memories from text. These are facts, preferences, patterns, or context about the user that would be useful to remember long-term.

Return a JSON array of objects with:
- memory_type: One of: fact, preference, pattern, context, goal, value
- content: The memory content (1-3 sentences)
- summary: Brief one-line summary
- salience: 0.0-1.0 how important (default 0.5)
- confidence: 0.0-1.0 how certain (default 0.8)

Only extract genuinely useful, durable memories. Return empty array if nothing qualifies.
Return ONLY the JSON array.`;

        const rawMemories = await callAI(OPENAI_API_KEY, memoryPrompt, text, 2048);
        const memories = parseJSON<Array<{ memory_type: string; content: string; summary: string; salience: number; confidence: number }>>(rawMemories);

        if (Array.isArray(memories) && memories.length > 0) {
          const memTexts = memories.map(m => m.content);
          const memEmbeddings = await generateEmbeddings(memTexts, OPENAI_API_KEY);

          const memRows = memories.map((m, i) => ({
            user_id: user.id,
            memory_type: m.memory_type,
            content: m.content,
            summary: m.summary,
            embedding: JSON.stringify(memEmbeddings[i]),
            salience: m.salience ?? 0.5,
            confidence: m.confidence ?? 0.8,
          }));
          await adminClient.from('wisdom_memories').insert(memRows);
          result.memories_extracted = memories.length;
        }
      } catch (e) {
        console.error('Memory extraction error:', e);
      }
    }

    // Step 6: Optionally generate a reflection note
    if (generate_reflection && entries.length >= 3) {
      try {
        const reflectionPrompt = `You are a reflective synthesis engine. Given a set of extracted knowledge entries, produce a brief reflection note that synthesizes the key themes, connects ideas, and identifies actionable patterns.

Return a JSON object with:
- content: The reflection (2-4 sentences, insightful)
- note_type: One of: synthesis, pattern, insight, lesson
- importance: 0.0-1.0

Return ONLY the JSON object.`;

        const entrySummary = entries.map(e => `- ${e.title}: ${e.content}`).join('\n');
        const rawReflection = await callAI(OPENAI_API_KEY, reflectionPrompt, `Source: ${source_person}\n\nEntries:\n${entrySummary}`, 1024);
        const reflection = parseJSON<{ content: string; note_type: string; importance: number }>(rawReflection);

        if (reflection?.content) {
          const [reflectionEmbedding] = await generateEmbeddings([reflection.content], OPENAI_API_KEY);
          await adminClient.from('reflection_notes').insert({
            user_id: user.id,
            source_ids: [sourceData.id],
            note_type: reflection.note_type || 'synthesis',
            content: reflection.content,
            embedding: JSON.stringify(reflectionEmbedding),
            importance: reflection.importance ?? 0.5,
          });
          result.reflection_generated = true;
        }
      } catch (e) {
        console.error('Reflection generation error:', e);
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Knowledge ingest error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
