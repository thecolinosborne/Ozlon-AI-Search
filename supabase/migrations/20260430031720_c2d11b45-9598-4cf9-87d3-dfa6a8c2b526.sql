
-- life_people: lightweight CRM for people in the user's life
CREATE TABLE public.life_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  relationship TEXT,                       -- e.g. "girlfriend", "mom", "dentist", "client"
  email TEXT,
  phone TEXT,
  birthday DATE,
  notes TEXT,
  last_contact_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX life_people_user_idx ON public.life_people(user_id);
CREATE INDEX life_people_birthday_idx ON public.life_people(birthday) WHERE birthday IS NOT NULL;

ALTER TABLE public.life_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own life_people select" ON public.life_people FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own life_people insert" ON public.life_people FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own life_people update" ON public.life_people FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own life_people delete" ON public.life_people FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER life_people_updated_at
BEFORE UPDATE ON public.life_people
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- life_events: recurring or one-off life admin (birthdays, dentist, oil change, follow-ups)
CREATE TABLE public.life_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  person_id UUID REFERENCES public.life_people(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                      -- 'birthday' | 'care' | 'reminder' | 'follow_up' | 'renewal' | 'open_intent'
  title TEXT NOT NULL,
  notes TEXT,
  next_due_at TIMESTAMPTZ,                 -- when to surface next
  last_done_at TIMESTAMPTZ,
  recurrence_days INTEGER,                 -- e.g. 180 for dentist, 90 for haircut, 365 for birthday
  desired_duration_minutes INTEGER,        -- how long it'd take, used for window matching
  status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'snoozed' | 'completed' | 'archived'
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX life_events_user_idx ON public.life_events(user_id);
CREATE INDEX life_events_due_idx ON public.life_events(user_id, next_due_at) WHERE status = 'active';
CREATE INDEX life_events_kind_idx ON public.life_events(user_id, kind);

ALTER TABLE public.life_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own life_events select" ON public.life_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own life_events insert" ON public.life_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own life_events update" ON public.life_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own life_events delete" ON public.life_events FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER life_events_updated_at
BEFORE UPDATE ON public.life_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- now_line_state: the single live one-line narration for the Today page
CREATE TABLE public.now_line_state (
  user_id UUID PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'calm',       -- 'calm' | 'attentive' | 'gentle' | 'celebratory'
  source TEXT,                             -- what triggered the latest narration
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.now_line_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own now_line select" ON public.now_line_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own now_line insert" ON public.now_line_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own now_line update" ON public.now_line_state FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own now_line delete" ON public.now_line_state FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER now_line_state_updated_at
BEFORE UPDATE ON public.now_line_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
