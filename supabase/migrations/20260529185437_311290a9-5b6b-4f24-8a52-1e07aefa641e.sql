
CREATE TABLE IF NOT EXISTS public.background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  progress INT NOT NULL DEFAULT 0,
  progress_message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  conversation_id UUID,
  assistant_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.background_jobs TO authenticated;
GRANT ALL ON public.background_jobs TO service_role;

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own jobs" ON public.background_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users create own jobs" ON public.background_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own jobs" ON public.background_jobs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own jobs" ON public.background_jobs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_background_jobs_user_status
  ON public.background_jobs(user_id, status, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_background_jobs_queue
  ON public.background_jobs(status, scheduled_for)
  WHERE status IN ('queued', 'running');

CREATE TRIGGER trg_background_jobs_updated_at
  BEFORE UPDATE ON public.background_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs;

-- Add health-check column to integration_connections
ALTER TABLE public.integration_connections
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_status TEXT;
