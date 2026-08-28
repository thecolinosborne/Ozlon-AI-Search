// Document ingest — takes a file already uploaded to the private `documents`
// bucket, extracts its text (native decode, zip-based office parsing, or
// multimodal AI for PDFs / images / audio), stores it in user_documents and
// returns a short summary so chat can immediately reason over it.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY') || '';
const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const VISION_MODEL = 'google/gemini-3.7-flash';

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|ya?ml|log|ts|tsx|js|jsx|py|rb|go|java|c|cpp|sql|sh|env|ini|toml)$/i;

function isTexty(mime: string, name: string) {
  return (
    mime.startsWith('text/') ||
    /json|xml|csv|yaml|javascript|typescript|markdown/.test(mime) ||
    TEXT_EXT.test(name)
  );
}

function b64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function clip(t: string, max = 120_000) {
  return t.length <= max ? t : t.slice(0, max) + `\n\n[...truncated ${t.length - max} chars]`;
}

/** Pull readable text out of OOXML (docx / xlsx / pptx) archives. */
async function extractOoxml(bytes: Uint8Array, name: string): Promise<string> {
  const { default: JSZip } = await import('https://esm.sh/jszip@3.10.1');
  const zip = await JSZip.loadAsync(bytes);
  const wanted: string[] = [];
  zip.forEach((path: string) => {
    if (/^word\/(document|footnotes|endnotes)\d*\.xml$/.test(path)) wanted.push(path);
    else if (/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(path)) wanted.push(path);
    else if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) wanted.push(path);
  });
  if (!wanted.length) throw new Error(`No readable content found inside ${name}`);
  wanted.sort();
  const out: string[] = [];
  for (const p of wanted) {
    const xml = await zip.file(p)!.async('string');
    const text = xml
      .replace(/<\/w:p>|<\/a:p>|<\/row>/g, '\n')
      .replace(/<\/w:tc>|<\/c>/g, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text) out.push(text);
  }
  const joined = out.join('\n\n').trim();
  if (!joined) throw new Error(`No readable text found inside ${name}`);
  return joined;
}

/** Use a multimodal model to read PDFs, images and audio. */
async function extractWithAI(bytes: Uint8Array, mime: string, name: string): Promise<string> {
  if (!LOVABLE_API_KEY) throw new Error('AI extraction is not configured.');
  const data = b64(bytes);
  let block: Record<string, unknown>;
  if (mime.startsWith('image/')) {
    block = { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } };
  } else if (mime.startsWith('audio/')) {
    const fmt = (name.split('.').pop() || 'mp3').toLowerCase();
    block = { type: 'input_audio', input_audio: { data, format: fmt } };
  } else {
    block = { type: 'file', file: { filename: name, file_data: `data:${mime || 'application/pdf'};base64,${data}` } };
  }

  const instruction = mime.startsWith('audio/')
    ? 'Transcribe this recording in full. Keep speaker turns if audible.'
    : 'Read this file completely and return its full contents as clean markdown text. Preserve headings, lists and tables. Transcribe any text visible in images. Do not summarize, do not add commentary.';

  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: instruction }, block] }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Extraction failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('The model returned no readable content for this file.');
  return text;
}

async function summarize(text: string, name: string): Promise<string> {
  if (!LOVABLE_API_KEY) return '';
  try {
    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3.1-flash-lite',
        messages: [
          { role: 'system', content: 'You write tight factual briefs. No emojis. Max 6 bullet points.' },
          { role: 'user', content: `File: ${name}\n\nSummarize what this document is and its key points.\n\n${text.slice(0, 40_000)}` },
        ],
      }),
    });
    if (!res.ok) return '';
    const j = await res.json();
    return j?.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Sign in to upload documents.' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'ingest';
    const admin = createClient(url, service);

    if (action === 'list') {
      const { data, error } = await admin
        .from('user_documents')
        .select('id,name,mime_type,size_bytes,summary,status,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return json({ error: error.message }, 500);
      return json({ documents: data || [] });
    }

    if (action === 'get') {
      const { data, error } = await admin
        .from('user_documents')
        .select('*')
        .eq('user_id', user.id)
        .eq('id', body.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: 'Document not found.' }, 404);
      return json({ document: data });
    }

    if (action === 'delete') {
      const { data: doc } = await admin
        .from('user_documents').select('storage_path').eq('user_id', user.id).eq('id', body.id).maybeSingle();
      if (doc?.storage_path) await admin.storage.from('documents').remove([doc.storage_path]);
      await admin.from('user_documents').delete().eq('user_id', user.id).eq('id', body.id);
      return json({ ok: true });
    }

    // ── ingest ──────────────────────────────────────────────────────────
    const storagePath: string = body.storage_path;
    const name: string = body.name || storagePath?.split('/').pop() || 'document';
    const mime: string = body.mime_type || '';
    if (!storagePath || !storagePath.startsWith(`${user.id}/`)) {
      return json({ error: 'Invalid storage path.' }, 400);
    }

    const { data: file, error: dlErr } = await admin.storage.from('documents').download(storagePath);
    if (dlErr || !file) return json({ error: `Could not read the uploaded file: ${dlErr?.message}` }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { data: row, error: insErr } = await admin
      .from('user_documents')
      .insert({
        user_id: user.id, name, mime_type: mime, size_bytes: bytes.length,
        storage_path: storagePath, status: 'processing',
      })
      .select('id').single();
    if (insErr) return json({ error: insErr.message }, 500);

    let text = '';
    try {
      if (isTexty(mime, name)) {
        text = new TextDecoder().decode(bytes);
      } else if (/\.(docx|xlsx|pptx)$/i.test(name) || /openxmlformats/.test(mime)) {
        text = await extractOoxml(bytes, name);
      } else {
        text = await extractWithAI(bytes, mime, name);
      }
    } catch (e) {
      const msg = (e as Error).message;
      await admin.from('user_documents').update({ status: 'failed', error: msg, updated_at: new Date().toISOString() }).eq('id', row.id);
      return json({ error: msg, document_id: row.id }, 422);
    }

    text = clip(text.trim());
    const summary = await summarize(text, name);
    await admin.from('user_documents')
      .update({ extracted_text: text, summary, status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', row.id);

    return json({
      document_id: row.id,
      name,
      chars: text.length,
      summary,
      preview: text.slice(0, 1500),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
