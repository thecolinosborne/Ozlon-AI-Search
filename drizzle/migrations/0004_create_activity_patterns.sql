CREATE TABLE public.activity_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pattern_key TEXT NOT NULL,
  label TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suggestion TEXT,
  status TEXT NOT NULL DEFAULT 'learning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_patterns TO authenticated;
GRANT ALL ON public.activity_patterns TO service_role;
ALTER TABLE public.activity_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own activity patterns"
  ON public.activity_patterns FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_activity_patterns_user ON public.activity_patterns (user_id, count DESC);