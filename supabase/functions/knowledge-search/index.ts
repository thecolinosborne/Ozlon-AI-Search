import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// MULTI-SCOPE KNOWLEDGE SEARCH
// Searches across: knowledge, memories, reflections
// Returns grouped results with weighted ranking
// ============================================================

interface SearchResult {
  id: string;
  type: 'knowledge' | 'memory' | 'reflection';
  title: string;
  content: string;
  similarity: number;
  weighted_score: number;
  metadata: Record<string, unknown>;
}

function weightedScore(
  similarity: number,
  opts: { salience?: number; confidence?: number; recurrence?: number; importance?: number; updatedAt?: string }
): number {
  let score = similarity * 0.6;

  // Salience/importance boost (0-1)
  const salienceVal = opts.salience ?? opts.importance ?? 0.5;
  score += salienceVal * 0.15;

  // Confidence boost
  score += (opts.confidence ?? 0.8) * 0.1;

  // Recency boost: within last 7 days = +0.1, 30 days = +0.05
  if (opts.updatedAt) {
    const age = Date.now() - new Date(opts.updatedAt).getTime();
    const days = age / (1000 * 60 * 60 * 24);
    if (days < 7) score += 0.1;
    else if (days < 30) score += 0.05;
  }

  // Recurrence boost
  if (opts.recurrence && opts.recurrence > 1) {
    score += Math.min(opts.recurrence * 0.01, 0.05);
  }

  return Math.min(score, 1);
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
      query,
      scope = 'all',        // 'knowledge' | 'memory' | 'reflection' | 'all'
      match_count = 10,
      threshold = 0.4,
      domain,
      category,
      memory_type,
      note_type,
    } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: 'query is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

    // Generate embedding
    const embeddingRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
    });
    if (!embeddingRes.ok) throw new Error('Failed to generate query embedding');
    const embeddingData = await embeddingRes.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const allResults: SearchResult[] = [];
    const scopes = scope === 'all' ? ['knowledge', 'memory', 'reflection'] : [scope];

    // Run searches in parallel
    const searches = scopes.map(async (s) => {
      switch (s) {
        case 'knowledge': {
          const { data } = await adminClient.rpc('match_knowledge', {
            query_embedding: JSON.stringify(queryEmbedding),
            match_threshold: threshold,
            match_count,
            filter_user_id: user.id,
            filter_domain: domain || null,
            filter_category: category || null,
          });
          if (data) {
            for (const r of data) {
              allResults.push({
                id: r.id,
                type: 'knowledge',
                title: `${r.title} (${r.source_person})`,
                content: r.content,
                similarity: r.similarity,
                weighted_score: weightedScore(r.similarity, {}),
                metadata: { source_person: r.source_person, domain: r.domain, category: r.category, tags: r.tags },
              });
            }
          }
          break;
        }
        case 'memory': {
          const { data } = await adminClient.rpc('match_wisdom_memories', {
            query_embedding: JSON.stringify(queryEmbedding),
            match_threshold: threshold,
            match_count,
            filter_user_id: user.id,
            filter_memory_type: memory_type || null,
          });
          if (data) {
            for (const r of data) {
              allResults.push({
                id: r.id,
                type: 'memory',
                title: r.summary || r.content.substring(0, 60),
                content: r.content,
                similarity: r.similarity,
                weighted_score: weightedScore(r.similarity, {
                  salience: r.salience,
                  confidence: r.confidence,
                  recurrence: r.recurrence_count,
                  updatedAt: r.updated_at,
                }),
                metadata: { memory_type: r.memory_type, salience: r.salience, confidence: r.confidence },
              });
            }
          }
          break;
        }
        case 'reflection': {
          const { data } = await adminClient.rpc('match_reflections', {
            query_embedding: JSON.stringify(queryEmbedding),
            match_threshold: threshold,
            match_count,
            filter_user_id: user.id,
            filter_note_type: note_type || null,
          });
          if (data) {
            for (const r of data) {
              allResults.push({
                id: r.id,
                type: 'reflection',
                title: r.content.substring(0, 60),
                content: r.content,
                similarity: r.similarity,
                weighted_score: weightedScore(r.similarity, { importance: r.importance }),
                metadata: { note_type: r.note_type, importance: r.importance },
              });
            }
          }
          break;
        }
      }
    });

    await Promise.all(searches);

    // Sort by weighted score, deduplicate by content similarity
    allResults.sort((a, b) => b.weighted_score - a.weighted_score);

    // Deduplicate: skip entries with very similar content
    const deduped: SearchResult[] = [];
    for (const r of allResults) {
      const isDupe = deduped.some(d => d.content === r.content || (d.title === r.title && d.type === r.type));
      if (!isDupe) deduped.push(r);
    }

    const finalResults = deduped.slice(0, match_count);

    // Build context bundle for chat injection
    const contextBundle = finalResults.map(r => {
      const label = r.type === 'knowledge' ? '📚' : r.type === 'memory' ? '🧠' : '💡';
      return `${label} [${r.type}] ${r.title}\n${r.content}`;
    }).join('\n\n---\n\n');

    // Group by type
    const grouped = {
      knowledge: finalResults.filter(r => r.type === 'knowledge'),
      memories: finalResults.filter(r => r.type === 'memory'),
      reflections: finalResults.filter(r => r.type === 'reflection'),
    };

    return new Response(JSON.stringify({
      results: finalResults,
      grouped,
      context_bundle: contextBundle,
      total: finalResults.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Knowledge search error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
