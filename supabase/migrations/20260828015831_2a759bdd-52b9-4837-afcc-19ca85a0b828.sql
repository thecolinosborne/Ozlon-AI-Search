ALTER TABLE public.discovered_events ADD COLUMN IF NOT EXISTS rsvp_status TEXT NOT NULL DEFAULT 'none';

CREATE OR REPLACE FUNCTION public.validate_event_rsvp_status() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rsvp_status NOT IN ('none','going','maybe','skip') THEN
    RAISE EXCEPTION 'invalid rsvp_status: %', NEW.rsvp_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_event_rsvp_status ON public.discovered_events;
CREATE TRIGGER trg_event_rsvp_status BEFORE INSERT OR UPDATE OF rsvp_status ON public.discovered_events
FOR EACH ROW EXECUTE FUNCTION public.validate_event_rsvp_status();

CREATE INDEX IF NOT EXISTS idx_discovered_events_rsvp ON public.discovered_events (user_id, rsvp_status);