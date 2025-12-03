-- Add voice settings columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS tts_provider text DEFAULT 'elevenlabs' CHECK (tts_provider IN ('elevenlabs', 'playht', 'auto')),
ADD COLUMN IF NOT EXISTS voice_id text,
ADD COLUMN IF NOT EXISTS elevenlabs_voice_id text,
ADD COLUMN IF NOT EXISTS playht_voice_id text,
ADD COLUMN IF NOT EXISTS auto_play_responses boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS voice_cloning_status text DEFAULT 'none' CHECK (voice_cloning_status IN ('none', 'pending', 'ready', 'failed')),
ADD COLUMN IF NOT EXISTS is_premium boolean DEFAULT false;