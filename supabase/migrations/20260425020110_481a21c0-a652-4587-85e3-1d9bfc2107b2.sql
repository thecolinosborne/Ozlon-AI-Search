DROP VIEW IF EXISTS public.recent_research;

CREATE VIEW public.recent_research
WITH (security_invoker = true) AS
SELECT
  rp.id,
  rp.user_id,
  rp.original_question,
  rp.confidence,
  array_length(rp.gaps_detected, 1) AS gap_count,
  jsonb_array_length(rp.sub_queries) AS subquery_count,
  rp.total_latency_ms,
  rp.created_at,
  EXTRACT(EPOCH FROM (now() - rp.created_at)) / 3600 AS age_hours
FROM public.research_plans rp
WHERE rp.status = 'completed'
ORDER BY rp.created_at DESC;