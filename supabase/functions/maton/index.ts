import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MATON_CTRL_URL = 'https://ctrl.maton.ai';
const MATON_GATEWAY_URL = 'https://gateway.maton.ai';

async function resolveMatonKey(req: Request, paramApiKey?: string): Promise<string> {
  // 1. Explicit param from request body
  if (paramApiKey) return paramApiKey;

  // 2. Per-user lookup from integration_connections
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const adminClient = createClient(supabaseUrl, serviceKey);
        const { data } = await adminClient
          .from('integration_connections')
          .select('metadata')
          .eq('user_id', user.id)
          .eq('provider', 'maton')
          .eq('status', 'connected')
          .single();
        const key = (data?.metadata as Record<string, string>)?.api_key;
        if (key) return key;
      }
    } catch { /* fall through */ }
  }

  // 3. Env var fallback
  const envKey = Deno.env.get('MATON_API_KEY');
  if (envKey) return envKey;

  throw new Error('MATON_API_KEY is not configured. Enter your API key in the integration settings.');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, path, body: reqBody, method: reqMethod, connectionId, apiKey: paramApiKey } = await req.json();

    const MATON_API_KEY = await resolveMatonKey(req, paramApiKey);

    const authHeaders: Record<string, string> = {
      'Authorization': `Bearer ${MATON_API_KEY}`,
      'Content-Type': 'application/json',
    };

    // Special action: upload a file from a URL to Google Drive
    if (action === 'drive_upload_from_url') {
      const { sourceUrl, fileName, mimeType } = reqBody || {};
      if (!sourceUrl || !fileName || !connectionId) {
        throw new Error('sourceUrl, fileName, and connectionId are required for drive_upload_from_url');
      }

      // Step 1: Download the file
      console.log(`Downloading file from ${sourceUrl}`);
      const fileResp = await fetch(sourceUrl);
      if (!fileResp.ok) {
        throw new Error(`Failed to download file: ${fileResp.status}`);
      }
      const fileBytes = new Uint8Array(await fileResp.arrayBuffer());
      const detectedMime = mimeType || fileResp.headers.get('content-type') || 'application/octet-stream';
      console.log(`Downloaded ${fileBytes.length} bytes, mime: ${detectedMime}`);

      // Step 2: Build multipart body for Google Drive upload
      const boundary = '---LovableBoundary' + Date.now();
      const metadata = JSON.stringify({ name: fileName, mimeType: detectedMime });

      const encoder = new TextEncoder();
      const parts: Uint8Array[] = [];

      // Metadata part
      parts.push(encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
      ));
      // File part
      parts.push(encoder.encode(
        `--${boundary}\r\nContent-Type: ${detectedMime}\r\nContent-Transfer-Encoding: binary\r\n\r\n`
      ));
      parts.push(fileBytes);
      parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

      // Combine
      let totalLen = 0;
      for (const p of parts) totalLen += p.length;
      const body = new Uint8Array(totalLen);
      let offset = 0;
      for (const p of parts) {
        body.set(p, offset);
        offset += p.length;
      }

      // Step 3: Upload via Maton gateway
      const uploadUrl = `${MATON_GATEWAY_URL}/google-drive/upload/drive/v3/files?uploadType=multipart`;
      console.log(`Uploading to Google Drive via ${uploadUrl}`);

      const uploadResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MATON_API_KEY}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Maton-Connection': connectionId,
        },
        body,
      });

      const uploadData = await uploadResp.json();
      if (!uploadResp.ok) {
        console.error('Drive upload error:', uploadResp.status, JSON.stringify(uploadData));
        return new Response(
          JSON.stringify({ error: `Drive upload failed: ${uploadResp.status}`, details: uploadData }),
          { status: uploadResp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Add webViewLink
      if (uploadData.id) {
        uploadData.webViewLink = `https://drive.google.com/file/d/${uploadData.id}/view`;
      }

      return new Response(JSON.stringify(uploadData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Standard actions
    let endpoint: string;
    let method = reqMethod || 'GET';
    let fetchBody: string | undefined;
    const headers: Record<string, string> = { ...authHeaders };

    switch (action) {
      case 'connections':
        endpoint = `${MATON_CTRL_URL}/connections`;
        break;

      case 'gateway':
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
