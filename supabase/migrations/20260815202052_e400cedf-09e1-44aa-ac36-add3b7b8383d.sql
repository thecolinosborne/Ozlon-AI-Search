-- ========== life_vision ==========
CREATE TABLE public.life_vision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  core_values text[] NOT NULL DEFAULT '{}',
  ten_year_target text,
  three_year_picture text,
  one_year_plan text,
  purpose text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.life_vision TO authenticated;
GRANT ALL ON public.life_vision TO service_role;
ALTER TABLE public.life_vision ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own life_vision" ON public.life_vision FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER life_vision_updated_at BEFORE UPDATE ON public.life_vision FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== life_rocks ==========
CREATE TABLE public.life_rocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  domain text NOT NULL DEFAULT 'work',
  quarter text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'on_track',
  progress integer NOT NULL DEFAULT 0,
  measurable text,
  goal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX life_rocks_user_quarter_idx ON public.life_rocks (user_id, quarter);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.life_rocks TO authenticated;
GRANT ALL ON public.life_rocks TO service_role;
ALTER TABLE public.life_rocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own life_rocks" ON public.life_rocks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER life_rocks_updated_at BEFORE UPDATE ON public.life_rocks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== life_scorecard_metrics ==========
CREATE TABLE public.life_scorecard_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  domain text NOT NULL DEFAULT 'work',
  unit text,
  target numeric,
  direction text NOT NULL DEFAULT 'at_least',
  cadence text NOT NULL DEFAULT 'weekly',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.life_scorecard_metrics TO authenticated;
GRANT ALL ON public.life_scorecard_metrics TO service_role;
ALTER TABLE public.life_scorecard_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own life_scorecard_metrics" ON public.life_scorecard_metrics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER life_scorecard_metrics_updated_at BEFORE UPDATE ON public.life_scorecard_metrics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== life_scorecard_entries ==========
CREATE TABLE public.life_scorecard_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  metric_id uuid NOT NULL REFERENCES public.life_scorecard_metrics(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  value numeric NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metric_id, period_start)
);
CREATE INDEX life_scorecard_entries_user_period_idx ON public.life_scorecard_entries (user_id, period_start DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.life_scorecard_entries TO authenticated;
GRANT ALL ON public.life_scorecard_entries TO service_role;
ALTER TABLE public.life_scorecard_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own life_scorecard_entries" ON public.life_scorecard_entries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ========== life_issues ==========
CREATE TABLE public.life_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  detail text,
  domain text NOT NULL DEFAULT 'work',
  priority integer NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'open',
  solution text,
  owner text,
  due_date date,
  rock_id uuid REFERENCES public.life_rocks(id) ON DELETE SET NULL,
  solved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX life_issues_user_status_idx ON public.life_issues (user_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.life_issues TO authenticated;
GRANT ALL ON public.life_issues TO service_role;
ALTER TABLE public.life_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own life_issues" ON public.life_issues FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER life_issues_updated_at BEFORE UPDATE ON public.life_issues FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== life_reviews ==========
CREATE TABLE public.life_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'weekly',
  period_start date NOT NULL,
  period_end date,
  summary text,
  scorecard_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rock_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  commitments jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, period_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.life_reviews TO authenticated;
GRANT ALL ON public.life_reviews TO service_role;
ALTER TABLE public.life_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own life_reviews" ON public.life_reviews FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER life_reviews_updated_at BEFORE UPDATE ON public.life_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();