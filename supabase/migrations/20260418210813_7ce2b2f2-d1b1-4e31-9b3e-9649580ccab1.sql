-- Custom models table (the "Stone Socket")
CREATE TABLE public.custom_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  model_id text NOT NULL,
  display_name text NOT NULL,
  gateway_url text NOT NULL DEFAULT 'https://ai.gateway.lovable.dev/v1/chat/completions',
  api_key_secret_name text,
  context_window integer NOT NULL DEFAULT 128000,
  cost_per_1k_in numeric NOT NULL DEFAULT 0,
  cost_per_1k_out numeric NOT NULL DEFAULT 0,
  avg_latency_ms integer NOT NULL DEFAULT 1000,
  capabilities text[] NOT NULL DEFAULT '{}',
  tier text NOT NULL DEFAULT 'standard',
  fallback_model_id text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, model_id)
);

ALTER TABLE public.custom_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own custom models" ON public.custom_models
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own custom models" ON public.custom_models
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own custom models" ON public.custom_models
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own custom models" ON public.custom_models
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on custom_models" ON public.custom_models
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_custom_models_updated_at
BEFORE UPDATE ON public.custom_models
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for AI-generated images
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Generated images are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'generated-images');

CREATE POLICY "Users upload to own folder in generated-images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'generated-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users update own generated images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'generated-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users delete own generated images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'generated-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);