import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Text-to-Speech Edge Function
 * 
 * Supports ElevenLabs as primary provider with Play.ht fallback (future)
 * Returns audio as base64 for client playback
 */

const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Default ElevenLabs voices
const DEFAULT_VOICES = {
  elevenlabs: 'EXAVITQu4vr4xnSDxMaL', // Sarah - natural female voice
};

interface TTSRequest {
  text: string;
  voiceId?: string;
  provider?: 'elevenlabs' | 'playht';
  model?: string;
}

async function synthesizeWithElevenLabs(
  text: string,
  voiceId: string,
  model: string = 'eleven_multilingual_v2'
): Promise<ArrayBuffer> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('ElevenLabs API error:', response.status, errorText);
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  return await response.arrayBuffer();
}

async function getUserVoiceSettings(userId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data, error } = await supabase
    .from('profiles')
    .select('tts_provider, voice_id, elevenlabs_voice_id, is_premium, auto_play_responses')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching user voice settings:', error);
    return null;
  }

  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voiceId, provider, model }: TTSRequest = await req.json();

    if (!text || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user ID from auth header if available
    const authHeader = req.headers.get('authorization');
    let userSettings = null;
    
    if (authHeader) {
      const supabase = createClient(
        SUPABASE_URL!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        userSettings = await getUserVoiceSettings(user.id);
      }
    }

    // Determine voice to use
    const selectedVoiceId = voiceId || 
      userSettings?.elevenlabs_voice_id || 
      userSettings?.voice_id || 
      DEFAULT_VOICES.elevenlabs;

    // Determine provider
    const selectedProvider = provider || userSettings?.tts_provider || 'elevenlabs';

    console.log('TTS Request:', {
      textLength: text.length,
      provider: selectedProvider,
      voiceId: selectedVoiceId,
      hasUserSettings: !!userSettings,
    });

    let audioBuffer: ArrayBuffer;

    if (selectedProvider === 'elevenlabs') {
      audioBuffer = await synthesizeWithElevenLabs(text, selectedVoiceId, model);
    } else {
      // Fallback to ElevenLabs for now (Play.ht can be added later)
      audioBuffer = await synthesizeWithElevenLabs(text, selectedVoiceId, model);
    }

    // Convert to base64 using chunked approach to avoid stack overflow
    const uint8Array = new Uint8Array(audioBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64Audio = btoa(binary);

    return new Response(
      JSON.stringify({ 
        audioContent: base64Audio,
        format: 'mp3',
        provider: selectedProvider,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('TTS Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'TTS failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
