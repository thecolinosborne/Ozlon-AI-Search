-- Phase 4: Adaptive Learning tables for Research subsystem

-- 1. source_reputation: per-domain trust scoring
CREATE TABLE public.source_reputation (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  domain TEXT NOT NULL,
  total_returned INTEGER NOT NULL DEFAULT 0,
  total_enriched INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  avg_freshness_days NUMERIC,
  trust_score NUMERIC NOT NULL DEFAULT 0.5,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, domain),
  CHECK (trust_score >= 0 AND trust_score <= 1)
);
CREATE INDEX idx_source_reputation_user_domain ON public.source_reputation(user_id, domain);
CREATE INDEX idx_source_reputation_trust ON public.source_reputation(user_id, trust_score DESC);

ALTER TABLE public.source_reputation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own source reputation" ON public.source_reputation FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access source_reputation" ON public.source_reputation FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. query_patterns: learned reformulations per intent
CREATE TABLE public.query_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  intent TEXT NOT NULL,
  pattern_hash TEXT NOT NULL,
  original_sample TEXT NOT NULL,
  rewritten TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  avg_result_count NUMERIC,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern_hash)
);
CREATE INDEX idx_query_patterns_lookup ON public.query_patterns(user_id, intent, pattern_hash);

ALTER TABLE public.query_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own query patterns" ON public.query_patterns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access query_patterns" ON public.query_patterns FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. research_failures: classified failure log
CREATE TABLE public.research_failures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  run_id UUID,
  action TEXT NOT NULL,
  intent TEXT,
  failure_class TEXT NOT NULL,
  provider TEXT,
  query TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_research_failures_user_class ON public.research_failures(user_id, failure_class, created_at DESC);
CREATE INDEX idx_research_failures_intent ON public.research_failures(user_id, intent, created_at DESC);

ALTER TABLE public.research_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own research failures" ON public.research_failures FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access research_failures" ON public.research_failures FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. cache_policy: per-intent TTL overrides (bounded 5min - 7days)
CREATE TABLE public.cache_policy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'default',
  ttl_seconds INTEGER NOT NULL DEFAULT 900,
  hit_count INTEGER NOT NULL DEFAULT 0,
  miss_count INTEGER NOT NULL DEFAULT 0,
  last_tuned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, action, intent),
  CHECK (ttl_seconds >= 300 AND ttl_seconds <= 604800)
);
CREATE INDEX idx_cache_policy_lookup ON public.cache_policy(user_id, action, intent);

ALTER TABLE public.cache_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own cache policy" ON public.cache_policy FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access cache_policy" ON public.cache_policy FOR ALL TO service_role USING (true) WITH CHECK (true);

-- updated_at triggers
CREATE TRIGGER set_source_reputation_updated_at BEFORE UPDATE ON public.source_reputation FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_query_patterns_updated_at BEFORE UPDATE ON public.query_patterns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_cache_policy_updated_at BEFORE UPDATE ON public.cache_policy FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. research_intelligence view: read-only debug surface
CREATE OR REPLACE VIEW public.research_intelligence
WITH (security_invoker = true)
AS
SELECT
  'source_reputation'::text AS kind,
  user_id,
  domain AS label,
  trust_score AS score,
  total_returned AS volume,
  last_seen_at AS last_at,
  jsonb_build_object('enriched', total_enriched, 'failed', total_failed, 'avg_freshness_days', avg_freshness_days) AS detail
FROM public.source_reputation
UNION ALL
SELECT
  'query_pattern'::text,
  user_id,
  intent || ': ' || left(rewritten, 60) AS label,
  CASE WHEN use_count > 0 THEN success_count::numeric / use_count ELSE 0 END AS score,
  use_count AS volume,
  last_used_at AS last_at,
  jsonb_build_object('original', original_sample, 'rewritten', rewritten, 'avg_results', avg_result_count) AS detail
FROM public.query_patterns
UNION ALL
SELECT
  'failure'::text,
  user_id,
  failure_class || coalesce(' / ' || provider, '') AS label,
  0::numeric AS score,
  1 AS volume,
  created_at AS last_at,
  jsonb_build_object('action', action, 'intent', intent, 'query', query, 'error', error_message) AS detail
FROM public.research_failures
UNION ALL
SELECT
  'cache_policy'::text,
  user_id,
  action || '/' || intent AS label,
  CASE WHEN (hit_count + miss_count) > 0 THEN hit_count::numeric / (hit_count + miss_count) ELSE 0 END AS score,
  hit_count + miss_count AS volume,
  last_tuned_at AS last_at,
  jsonb_build_object('ttl_seconds', ttl_seconds, 'hits', hit_count, 'misses', miss_count) AS detail
FROM public.cache_policy;