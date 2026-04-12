
-- Table: viral_creative_sessions
CREATE TABLE public.viral_creative_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  request_text text,
  platform text,
  content_goal text,
  source_context jsonb DEFAULT '{}'::jsonb,
  angle_outputs jsonb DEFAULT '[]'::jsonb,
  hook_outputs jsonb DEFAULT '[]'::jsonb,
  prompt_candidates jsonb DEFAULT '[]'::jsonb,
  selected_prompts jsonb DEFAULT '[]'::jsonb,
  score_data jsonb DEFAULT '{}'::jsonb,
  output_metadata jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.viral_creative_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own viral creative sessions"
  ON public.viral_creative_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own viral creative sessions"
  ON public.viral_creative_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own viral creative sessions"
  ON public.viral_creative_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own viral creative sessions"
  ON public.viral_creative_sessions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_viral_creative_sessions_updated_at
  BEFORE UPDATE ON public.viral_creative_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Table: creative_reference_assets
CREATE TABLE public.creative_reference_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  asset_type text,
  source_url text,
  notes text,
  analysis jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_reference_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own creative reference assets"
  ON public.creative_reference_assets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own creative reference assets"
  ON public.creative_reference_assets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own creative reference assets"
  ON public.creative_reference_assets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own creative reference assets"
  ON public.creative_reference_assets FOR DELETE
  USING (auth.uid() = user_id);
