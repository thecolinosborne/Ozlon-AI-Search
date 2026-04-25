CREATE TABLE public.research_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  query TEXT,
  action TEXT NOT NULL,
  providers_attempted TEXT[] NOT NULL DEFAULT '{}',
  providers_succeeded TEXT[] NOT NULL DEFAULT '{}',
  result_count INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT false,
  error_class TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.research_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own research runs"
  ON public.research_runs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_research_runs_user_created ON public.research_runs (user_id, created_at DESC);
CREATE INDEX idx_research_runs_action ON public.research_runs (action);