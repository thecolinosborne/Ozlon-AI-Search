-- ============================================================
-- SIGNALS — Awareness Layer (Phase A)
-- ============================================================

-- pgvector lives in extensions
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ============================================================
-- 1. signal_moments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.signal_moments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'general',
  headline            TEXT NOT NULL,
  reason              TEXT,
  suggested_direction TEXT,
  salience            DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  confidence          DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  mode_context        TEXT NOT NULL DEFAULT 'any',
  source_refs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  wisdom_memory_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  embedding           extensions.vector(1536),
  status              TEXT NOT NULL DEFAULT 'live',
  acted_at            TIMESTAMPTZ,
  ignored_at          TIMESTAMPTZ,
  dismissed_at        TIMESTAMPTZ,
  outcome_note        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '6 hours')
);

-- Validation trigger (free-form text, not CHECK constraint per memory rule)
CREATE OR REPLACE FUNCTION public.validate_signal_moment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('live','acted','ignored','dismissed','expired','superseded') THEN
    RAISE EXCEPTION 'invalid status: %', NEW.status;
  END IF;
  IF NEW.mode_context NOT IN ('focus','idle','planning','reactive','any') THEN
    RAISE EXCEPTION 'invalid mode_context: %', NEW.mode_context;
  END IF;
  IF NEW.salience < 0 OR NEW.salience > 1 THEN
    RAISE EXCEPTION 'salience out of range';
  END IF;
  IF NEW.confidence < 0 OR NEW.confidence > 1 THEN
    RAISE EXCEPTION 'confidence out of range';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_signal_moment ON public.signal_moments;
CREATE TRIGGER trg_validate_signal_moment
  BEFORE INSERT OR UPDATE ON public.signal_moments
  FOR EACH ROW EXECUTE FUNCTION public.validate_signal_moment();

CREATE INDEX IF NOT EXISTS idx_signal_moments_user_active
  ON public.signal_moments (user_id, status, salience DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_moments_expires
  ON public.signal_moments (expires_at) WHERE status = 'live';

ALTER TABLE public.signal_moments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own signal moments"
  ON public.signal_moments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own signal moments"
  ON public.signal_moments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own signal moments"
  ON public.signal_moments FOR DELETE
  USING (auth.uid() = user_id);

-- Inserts come exclusively from the synthesizer (service role).
CREATE POLICY "Service role full access on signal_moments"
  ON public.signal_moments FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_moments;

-- ============================================================
-- 2. user_context_state
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_context_state (
  user_id                  UUID PRIMARY KEY,
  current_mode             TEXT NOT NULL DEFAULT 'idle',
  cognitive_load_estimate  DOUBLE PRECISION NOT NULL DEFAULT 0.3,
  last_interaction_at      TIMESTAMPTZ,
  quiet_hours              JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_user_context_state()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.current_mode NOT IN ('focus','idle','planning','reactive') THEN
    RAISE EXCEPTION 'invalid current_mode: %', NEW.current_mode;
  END IF;
  IF NEW.cognitive_load_estimate < 0 OR NEW.cognitive_load_estimate > 1 THEN
    RAISE EXCEPTION 'cognitive_load_estimate out of range';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_user_context_state ON public.user_context_state;
CREATE TRIGGER trg_validate_user_context_state
  BEFORE INSERT OR UPDATE ON public.user_context_state
  FOR EACH ROW EXECUTE FUNCTION public.validate_user_context_state();

ALTER TABLE public.user_context_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own context state"
  ON public.user_context_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own context state"
  ON public.user_context_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own context state"
  ON public.user_context_state FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on user_context_state"
  ON public.user_context_state FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 3. match_signal_moments — dedup helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.match_signal_moments(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.85,
  match_count integer DEFAULT 5,
  filter_user_id uuid DEFAULT NULL,
  hours_back integer DEFAULT 48
)
RETURNS TABLE (
  id uuid,
  kind text,
  headline text,
  salience double precision,
  status text,
  created_at timestamptz,
  similarity double precision
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = extensions, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sm.id, sm.kind, sm.headline, sm.salience, sm.status, sm.created_at,
    (1 - (sm.embedding <=> query_embedding))::float AS similarity
  FROM public.signal_moments sm
  WHERE sm.user_id = filter_user_id
    AND sm.embedding IS NOT NULL
    AND sm.created_at > now() - (hours_back || ' hours')::interval
    AND (1 - (sm.embedding <=> query_embedding)) > match_threshold
  ORDER BY sm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;