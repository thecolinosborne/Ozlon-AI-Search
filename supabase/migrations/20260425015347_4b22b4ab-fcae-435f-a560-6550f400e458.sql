-- Research plans: tracks multi-hop investigations
CREATE TABLE public.research_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  original_question TEXT NOT NULL,
  sub_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
  intents TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  total_cost_estimate NUMERIC DEFAULT 0,
  total_latency_ms INTEGER DEFAULT 0,
  final_answer TEXT,
  final_answer_hash TEXT,
  confidence NUMERIC DEFAULT 0,
  gaps_detected TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_research_plans_user_created ON public.research_plans(user_id, created_at DESC);
CREATE INDEX idx_research_plans_question_hash ON public.research_plans(final_answer_hash) WHERE final_answer_hash IS NOT NULL;

ALTER TABLE public.research_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own research plans"
  ON public.research_plans FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users create own research plans"
  ON public.research_plans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own research plans"
  ON public.research_plans FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_research_plans_updated_at
  BEFORE UPDATE ON public.research_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Link individual research runs to their parent plan (nullable for backward compat)
ALTER TABLE public.research_runs
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.research_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_research_runs_plan_id ON public.research_runs(plan_id) WHERE plan_id IS NOT NULL;