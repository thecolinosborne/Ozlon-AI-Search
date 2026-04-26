ALTER TABLE public.signal_moments
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_signal_moments_user_kind_status
  ON public.signal_moments (user_id, kind, status);