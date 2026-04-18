ALTER TABLE public.custom_models
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_custom_models_platform_id
ON public.custom_models ((metadata->>'platform_id'));