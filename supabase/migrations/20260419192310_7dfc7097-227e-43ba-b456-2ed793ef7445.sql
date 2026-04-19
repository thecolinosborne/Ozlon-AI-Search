-- Enable required extensions for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Scheduled routines: user-defined recurring AI workflows
CREATE TABLE public.scheduled_routines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  delivery_channel TEXT NOT NULL DEFAULT 'in_app',
  delivery_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own routines" ON public.scheduled_routines
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own routines" ON public.scheduled_routines
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own routines" ON public.scheduled_routines
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own routines" ON public.scheduled_routines
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on routines" ON public.scheduled_routines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_scheduled_routines_updated_at
  BEFORE UPDATE ON public.scheduled_routines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_scheduled_routines_user ON public.scheduled_routines(user_id);
CREATE INDEX idx_scheduled_routines_active ON public.scheduled_routines(active, next_run_at);

-- Routine runs: log of every execution
CREATE TABLE public.routine_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  routine_id UUID NOT NULL REFERENCES public.scheduled_routines(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  triggered_by TEXT NOT NULL DEFAULT 'cron',
  output TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.routine_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own runs" ON public.routine_runs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on runs" ON public.routine_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_routine_runs_routine ON public.routine_runs(routine_id, started_at DESC);
CREATE INDEX idx_routine_runs_user ON public.routine_runs(user_id, started_at DESC);