
-- AI Providers ("Stones" in the Gauntlet)
CREATE TABLE public.ai_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('lovable', 'openai', 'gemini', 'anthropic')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  priority INTEGER NOT NULL DEFAULT 100,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'manual')),
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_ai_providers_user ON public.ai_providers(user_id, status);

ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own providers" ON public.ai_providers
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own providers" ON public.ai_providers
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own providers" ON public.ai_providers
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own providers" ON public.ai_providers
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_ai_providers_updated_at
  BEFORE UPDATE ON public.ai_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Routing log
CREATE TABLE public.gauntlet_routing_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  run_id UUID,
  node_type TEXT,
  modality TEXT,
  complexity TEXT,
  chosen_stone TEXT NOT NULL,
  chosen_model TEXT,
  reason TEXT,
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  cost_estimate NUMERIC(10, 6),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_routing_log_user_time ON public.gauntlet_routing_log(user_id, created_at DESC);

ALTER TABLE public.gauntlet_routing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own routing log" ON public.gauntlet_routing_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own routing log" ON public.gauntlet_routing_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);
