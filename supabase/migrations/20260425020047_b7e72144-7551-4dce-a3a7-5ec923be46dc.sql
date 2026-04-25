-- Phase 6: plan recall + cross-plan reuse
ALTER TABLE public.research_plans
  ADD COLUMN IF NOT EXISTS original_question_embedding extensions.vector(1536);

CREATE INDEX IF NOT EXISTS idx_research_plans_embedding
  ON public.research_plans
  USING ivfflat (original_question_embedding extensions.vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION public.match_research_plans(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.75,
  match_count integer DEFAULT 5,
  filter_user_id uuid DEFAULT NULL,
  max_age_hours integer DEFAULT 168
)
RETURNS TABLE(
  id uuid,
  original_question text,
  final_answer text,
  confidence numeric,
  gaps_detected text[],
  sub_queries jsonb,
  created_at timestamptz,
  similarity double precision
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'extensions', 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rp.id,
    rp.original_question,
    rp.final_answer,
    rp.confidence,
    rp.gaps_detected,
    rp.sub_queries,
    rp.created_at,
    (1 - (rp.original_question_embedding <=> query_embedding))::float AS similarity
  FROM public.research_plans rp
  WHERE rp.user_id = filter_user_id
    AND rp.original_question_embedding IS NOT NULL
    AND rp.status = 'completed'
    AND rp.created_at > now() - (max_age_hours || ' hours')::interval
    AND (1 - (rp.original_question_embedding <=> query_embedding)) > match_threshold
  ORDER BY rp.original_question_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE VIEW public.recent_research AS
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