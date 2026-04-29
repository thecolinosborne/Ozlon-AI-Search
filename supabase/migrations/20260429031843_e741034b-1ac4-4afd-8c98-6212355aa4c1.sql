-- Phase 3 of the Skill Loop: proposed principles awaiting user review.
-- A nightly (or on-demand) reviewer clusters skill observations into
-- candidate principles. Users approve or reject; only approved ones
-- are written into cross_cutting_principles.

CREATE TABLE IF NOT EXISTS public.proposed_principles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  principle TEXT NOT NULL,
  rationale TEXT,
  source_reflection_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  observation_count INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | superseded
  decided_at TIMESTAMPTZ,
  decided_principle_id UUID, -- if approved, the new cross_cutting_principles row id
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.proposed_principles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own proposed principles"
  ON public.proposed_principles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own proposed principles"
  ON public.proposed_principles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own proposed principles"
  ON public.proposed_principles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own proposed principles"
  ON public.proposed_principles FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access proposed principles"
  ON public.proposed_principles FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_proposed_principles_user_status
  ON public.proposed_principles (user_id, status, created_at DESC);

CREATE TRIGGER trg_proposed_principles_updated_at
  BEFORE UPDATE ON public.proposed_principles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();