
CREATE TABLE public.discovered_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  location TEXT,
  url TEXT,
  source TEXT,
  category TEXT DEFAULT 'networking',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.discovered_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own events" ON public.discovered_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own events" ON public.discovered_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own events" ON public.discovered_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own events" ON public.discovered_events FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on discovered_events" ON public.discovered_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_discovered_events_updated_at
  BEFORE UPDATE ON public.discovered_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_discovered_events_user_date ON public.discovered_events (user_id, event_date);
CREATE INDEX idx_discovered_events_category ON public.discovered_events (category);
