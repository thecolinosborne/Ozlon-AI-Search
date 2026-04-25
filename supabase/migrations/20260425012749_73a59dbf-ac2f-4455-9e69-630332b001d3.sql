CREATE TABLE public.research_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  cache_key TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, cache_key)
);

ALTER TABLE public.research_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own research cache"
  ON public.research_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_research_cache_lookup ON public.research_cache (user_id, cache_key, expires_at);
CREATE INDEX idx_research_cache_expires ON public.research_cache (expires_at);

CREATE OR REPLACE VIEW public.research_runs_summary
WITH (security_invoker = true) AS
SELECT
  user_id,
  action,
  date_trunc('day', created_at) AS day,
  count(*) AS total_calls,
  count(*) FILTER (WHERE success) AS successful_calls,
  round(100.0 * count(*) FILTER (WHERE success) / NULLIF(count(*), 0), 1) AS success_rate_pct,
  round(avg(latency_ms)::numeric, 0) AS avg_latency_ms,
  (percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_latency_ms,
  round(avg(result_count)::numeric, 1) AS avg_result_count
FROM public.research_runs
GROUP BY user_id, action, date_trunc('day', created_at);