-- Cross-cutting principles: universal authoring rules extracted from clusters
-- of skill observations. Re-injected into every future skill proposal so the
-- AI's authoring quality floor rises over time.
--
-- Adapted from "One Skill to Rule Them All" by Eoghan Henn / rebelytics.com
-- (https://github.com/rebelytics/one-skill-to-rule-them-all) under CC BY 4.0.

CREATE TABLE IF NOT EXISTS public.cross_cutting_principles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  principle text NOT NULL,
  source_reflection_ids uuid[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cross_cutting_principles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own principles"
  ON public.cross_cutting_principles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own principles"
  ON public.cross_cutting_principles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own principles"
  ON public.cross_cutting_principles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own principles"
  ON public.cross_cutting_principles FOR DELETE
  USING (auth.uid() = user_id);

-- Service role for the cron worker that proposes new principles.
CREATE POLICY "Service role full access on principles"
  ON public.cross_cutting_principles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_principles_user_active
  ON public.cross_cutting_principles (user_id, active);

CREATE INDEX IF NOT EXISTS idx_principles_created
  ON public.cross_cutting_principles (created_at DESC);

CREATE TRIGGER update_principles_updated_at
  BEFORE UPDATE ON public.cross_cutting_principles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
