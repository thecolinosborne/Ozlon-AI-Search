
CREATE TABLE public.research_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  report TEXT,
  sources JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.research_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own research tasks"
ON public.research_tasks FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own research tasks"
ON public.research_tasks FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own research tasks"
ON public.research_tasks FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own research tasks"
ON public.research_tasks FOR DELETE
USING (auth.uid() = user_id);

-- Service role needs to update from edge functions
CREATE POLICY "Service role full access"
ON public.research_tasks FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
