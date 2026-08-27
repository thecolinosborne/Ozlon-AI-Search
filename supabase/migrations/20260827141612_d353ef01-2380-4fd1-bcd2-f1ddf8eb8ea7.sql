ALTER TABLE public.discovered_events
  ADD COLUMN IF NOT EXISTS venue_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS organizer TEXT,
  ADD COLUMN IF NOT EXISTS registration_url TEXT,
  ADD COLUMN IF NOT EXISTS cost_text TEXT,
  ADD COLUMN IF NOT EXISTS cost_min NUMERIC,
  ADD COLUMN IF NOT EXISTS cost_max NUMERIC,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN,
  ADD COLUMN IF NOT EXISTS ticket_notes TEXT,
  ADD COLUMN IF NOT EXISTS rsvp_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS calendar_event_id TEXT,
  ADD COLUMN IF NOT EXISTS calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS added_to_calendar_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS discovered_events_user_dedupe
  ON public.discovered_events (user_id, lower(title), COALESCE(event_date, '-infinity'::timestamptz));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovered_events TO authenticated;
GRANT ALL ON public.discovered_events TO service_role;