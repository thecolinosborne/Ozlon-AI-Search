import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Available ElevenLabs voices for selection
const AVAILABLE_VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Warm & natural female voice', premium: false },
  { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', description: 'Expressive & dynamic female voice', premium: false },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', description: 'Confident male voice', premium: false },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Professional male voice', premium: false },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Friendly male voice', premium: false },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', description: 'Elegant female voice', premium: true },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Youthful female voice', premium: true },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative male voice', premium: true },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'GET') {
      // Get voice settings
      const { data, error } = await supabase
        .from('profiles')
        .select('tts_provider, voice_id, elevenlabs_voice_id, playht_voice_id, auto_play_responses, voice_cloning_status, is_premium')
        .eq('user_id', user.id)
        .single();

      if (error) {
        console.error('Error fetching voice settings:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch voice settings' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          settings: data,
          availableVoices: AVAILABLE_VOICES,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'POST') {
      // Update voice settings
      const updates = await req.json();
      
      // Validate provider
      if (updates.tts_provider && !['elevenlabs', 'playht', 'auto'].includes(updates.tts_provider)) {
        return new Response(
          JSON.stringify({ error: 'Invalid TTS provider' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Only allow certain fields to be updated
      const allowedFields = [
        'tts_provider',
        'voice_id', 
        'elevenlabs_voice_id',
        'playht_voice_id',
        'auto_play_responses',
      ];

      const sanitizedUpdates: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          sanitizedUpdates[field] = updates[field];
        }
      }

      const { data, error } = await supabase
        .from('profiles')
        .update(sanitizedUpdates)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating voice settings:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to update voice settings' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ settings: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Voice settings error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
