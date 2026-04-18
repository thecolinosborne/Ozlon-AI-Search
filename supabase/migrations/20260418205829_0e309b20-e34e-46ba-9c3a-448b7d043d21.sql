-- User model routing preferences
CREATE TABLE public.user_model_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'balanced' CHECK (mode IN ('speed', 'balanced', 'quality')),
  agent_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  disabled_models TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_model_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own model prefs"
  ON public.user_model_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own model prefs"
  ON public.user_model_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own model prefs"
  ON public.user_model_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own model prefs"
  ON public.user_model_preferences FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_user_model_preferences_updated_at
  BEFORE UPDATE ON public.user_model_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Model routing telemetry log
CREATE TABLE public.model_routing_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  agent TEXT NOT NULL,
  model_used TEXT NOT NULL,
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  primary_model TEXT,
  error_code TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.model_routing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own routing log"
  ON public.model_routing_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on routing log"
  ON public.model_routing_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_routing_log_user_created ON public.model_routing_log (user_id, created_at DESC);
CREATE INDEX idx_routing_log_user_agent ON public.model_routing_log (user_id, agent, created_at DESC);