-- Create user_personality table for AI identity & persona authoring
CREATE TABLE public.user_personality (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  identity JSONB NOT NULL DEFAULT '{}'::jsonb,
  about_me TEXT,
  house_rules TEXT[] NOT NULL DEFAULT '{}'::text[],
  tone_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_persona TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_personality ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own personality"
  ON public.user_personality FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own personality"
  ON public.user_personality FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own personality"
  ON public.user_personality FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own personality"
  ON public.user_personality FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_user_personality_updated_at
  BEFORE UPDATE ON public.user_personality
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();