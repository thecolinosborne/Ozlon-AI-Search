CREATE TABLE public.life_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  why text,
  target_date date,
  progress numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  last_touched_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.life_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own life_goals select" ON public.life_goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own life_goals insert" ON public.life_goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own life_goals update" ON public.life_goals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own life_goals delete" ON public.life_goals FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX life_goals_user_status_idx ON public.life_goals (user_id, status);

CREATE TRIGGER life_goals_set_updated_at
BEFORE UPDATE ON public.life_goals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();