// Summarize a chat session and persist to chat_sessions.summary
// Uses Lovable AI Gateway (Gemini Flash). Runs as the user — RLS enforces ownership.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claims } = await supabase.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { session_id } = await req.json();
    if (!session_id || typeof session_id !== 'string') {
      return new Response(JSON.stringify({ error: 'session_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Load session + last 30 messages (RLS enforces ownership)
    const [sessionRes, msgRes] = await Promise.all([
      supabase.from('chat_sessions').select('id, title, summary').eq('id', session_id).maybeSingle(),
      supabase.from('chat_messages').select('role, content, created_at').eq('session_id', session_id).order('created_at', { ascending: false }).limit(30),
    ]);

    if (!sessionRes.data) {
      return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const messages = (msgRes.data || []).reverse();
    if (messages.length < 2) {
      return new Response(JSON.stringify({ skipped: true, reason: 'too few messages' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const transcript = messages.map((m: { role: string; content: string }) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n').slice(0, 12000);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Summarize the conversation in 2-3 sentences capturing topics discussed, decisions made, and any open threads. Return ONLY a JSON object: {"summary": "...", "title": "short 4-7 word title"}. No prose, no markdown fences.' },
          { role: 'user', content: transcript },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('AI gateway error:', aiRes.status, errText);
      return new Response(JSON.stringify({ error: 'Summarization failed' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiJson = await aiRes.json();
    const raw = aiJson.choices?.[0]?.message?.content || '{}';
    const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
    let parsed: { summary?: string; title?: string } = {};
    try { parsed = JSON.parse(cleaned); } catch { parsed = { summary: cleaned.slice(0, 400) }; }

    const summary = (parsed.summary || '').trim().slice(0, 1000);
    const newTitle = (parsed.title || '').trim().slice(0, 80);

    if (!summary) {
      return new Response(JSON.stringify({ skipped: true, reason: 'empty summary' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const update: Record<string, unknown> = { summary, updated_at: new Date().toISOString() };
    const currentTitle = (sessionRes.data as { title?: string }).title;
    if (newTitle && (!currentTitle || currentTitle === 'New conversation')) {
      update.title = newTitle;
    }

    const { error: updErr } = await supabase.from('chat_sessions').update(update).eq('id', session_id);
    if (updErr) {
      console.error('Update error:', updErr);
      return new Response(JSON.stringify({ error: updErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, summary, title: update.title }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('summarize-session error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
