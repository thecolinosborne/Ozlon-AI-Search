-- Add voice_enabled column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS voice_enabled boolean DEFAULT false;

-- Update the handle_new_user function to set default voice settings
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_url, voice_enabled, elevenlabs_voice_id)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url',
    false,
    'tmE7FLz96JX0kHVdP6qw'
  );
  RETURN NEW;
END;
$$;