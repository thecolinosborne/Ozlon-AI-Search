CREATE TABLE IF NOT EXISTS public.slack_processed_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT,
  channel TEXT,
  user_id_slack TEXT,
  thread_ts TEXT,
  response_ts TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slack_processed_events_created_at
  ON public.slack_processed_events(created_at DESC);

ALTER TABLE public.slack_processed_events ENABLE ROW LEVEL SECURITY;

-- Service role only (no client access). Deny-all policy for authenticated/anon.
CREATE POLICY "No client access to slack_processed_events"
  ON public.slack_processed_events
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);