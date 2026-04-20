ALTER TABLE public.ai_providers DROP CONSTRAINT IF EXISTS ai_providers_provider_check;

ALTER TABLE public.ai_providers
ADD CONSTRAINT ai_providers_provider_check
CHECK (provider = ANY (ARRAY['lovable'::text, 'openai'::text, 'gemini'::text, 'anthropic'::text, 'higgsfield'::text]));