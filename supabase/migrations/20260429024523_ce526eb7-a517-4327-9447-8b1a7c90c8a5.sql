-- Phase 2: The Stack persistence columns on signal_moments
ALTER TABLE public.signal_moments
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.signal_moments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_ref text;

CREATE INDEX IF NOT EXISTS idx_signal_moments_user_status_due
  ON public.signal_moments(user_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_signal_moments_user_snoozed
  ON public.signal_moments(user_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_moments_user_pinned
  ON public.signal_moments(user_id, pinned_at)
  WHERE pinned_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_moments_parent
  ON public.signal_moments(parent_id)
  WHERE parent_id IS NOT NULL;

-- Trigger: auto-set completed_at when status flips to 'acted'
CREATE OR REPLACE FUNCTION public.set_signal_moment_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'acted' AND (OLD.status IS NULL OR OLD.status <> 'acted') THEN
    NEW.completed_at = COALESCE(NEW.completed_at, now());
  ELSIF NEW.status <> 'acted' AND OLD.status = 'acted' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_moments_completed_at ON public.signal_moments;
CREATE TRIGGER trg_signal_moments_completed_at
  BEFORE UPDATE ON public.signal_moments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_signal_moment_completed_at();

-- Daily summary for analytics
CREATE TABLE IF NOT EXISTS public.stack_daily_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day date NOT NULL,
  cleared_count integer NOT NULL DEFAULT 0,
  snoozed_count integer NOT NULL DEFAULT 0,
  dismissed_count integer NOT NULL DEFAULT 0,
  added_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

ALTER TABLE public.stack_daily_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own stack summary"
  ON public.stack_daily_summary FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own stack summary"
  ON public.stack_daily_summary FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own stack summary"
  ON public.stack_daily_summary FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access stack summary"
  ON public.stack_daily_summary FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_stack_daily_summary_updated_at
  BEFORE UPDATE ON public.stack_daily_summary
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();