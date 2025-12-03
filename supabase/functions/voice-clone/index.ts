import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Voice Cloning Edge Function
 * 
 * Creates a cloned voice using ElevenLabs Instant Voice Cloning
 * Requires audio sample(s) from the user
 */

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

    if (!ELEVENLABS_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Voice cloning service not configured' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'POST') {
      const { audio, name } = await req.json();

      if (!audio) {
        return new Response(
          JSON.stringify({ error: 'Audio sample is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update status to pending
      const serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await serviceSupabase
        .from('profiles')
        .update({ voice_cloning_status: 'pending' })
        .eq('user_id', user.id);

      try {
        // Decode base64 audio
        const binaryAudio = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
        const audioBlob = new Blob([binaryAudio], { type: 'audio/mp3' });

        // Create form data for ElevenLabs API
        const formData = new FormData();
        formData.append('name', name || `${user.id.slice(0, 8)}_clone`);
        formData.append('files', audioBlob, 'voice_sample.mp3');
        formData.append('description', 'User cloned voice for Ozlon');

        // Call ElevenLabs Voice Cloning API (Instant Voice Cloning)
        const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('ElevenLabs cloning error:', response.status, errorText);
          
          // Update status to failed
          await serviceSupabase
            .from('profiles')
            .update({ voice_cloning_status: 'failed' })
            .eq('user_id', user.id);

          return new Response(
            JSON.stringify({ error: 'Voice cloning failed', details: errorText }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const result = await response.json();
        console.log('Voice cloning result:', result);

        // Save the cloned voice ID to user profile
        await serviceSupabase
          .from('profiles')
          .update({ 
            elevenlabs_voice_id: result.voice_id,
            voice_id: result.voice_id,
            voice_cloning_status: 'ready',
          })
          .eq('user_id', user.id);

        return new Response(
          JSON.stringify({ 
            success: true,
            voiceId: result.voice_id,
            message: 'Voice cloned successfully',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      } catch (cloneError) {
        console.error('Cloning process error:', cloneError);
        
        // Update status to failed
        await serviceSupabase
          .from('profiles')
          .update({ voice_cloning_status: 'failed' })
          .eq('user_id', user.id);

        throw cloneError;
      }
    }

    if (req.method === 'GET') {
      // Check cloning status
      const { data, error } = await supabase
        .from('profiles')
        .select('voice_cloning_status, elevenlabs_voice_id')
        .eq('user_id', user.id)
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch cloning status' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          status: data.voice_cloning_status,
          voiceId: data.elevenlabs_voice_id,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Voice clone error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
