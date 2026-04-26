-- Skills catalog
CREATE TABLE public.skills (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0.0',
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('builtin','user','imported')),
  author_user_id UUID,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','org','public')),
  trust_tier SMALLINT NOT NULL DEFAULT 1 CHECK (trust_tier BETWEEN 0 AND 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skills_visibility ON public.skills(visibility);
CREATE INDEX idx_skills_source ON public.skills(source);
CREATE INDEX idx_skills_author ON public.skills(author_user_id);

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View public, builtin, or own skills"
  ON public.skills FOR SELECT
  USING (
    visibility = 'public'
    OR source = 'builtin'
    OR author_user_id = auth.uid()
  );

CREATE POLICY "Users insert own skills"
  ON public.skills FOR INSERT
  WITH CHECK (author_user_id = auth.uid() AND source <> 'builtin');

CREATE POLICY "Users update own skills"
  ON public.skills FOR UPDATE
  USING (author_user_id = auth.uid() AND source <> 'builtin')
  WITH CHECK (author_user_id = auth.uid() AND source <> 'builtin');

CREATE POLICY "Users delete own skills"
  ON public.skills FOR DELETE
  USING (author_user_id = auth.uid() AND source <> 'builtin');

CREATE POLICY "Service role full access on skills"
  ON public.skills FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_skills_updated_at
  BEFORE UPDATE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-user installs
CREATE TABLE public.skill_installs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, skill_id)
);

CREATE INDEX idx_skill_installs_user ON public.skill_installs(user_id);

ALTER TABLE public.skill_installs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own installs"
  ON public.skill_installs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own installs"
  ON public.skill_installs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own installs"
  ON public.skill_installs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own installs"
  ON public.skill_installs FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on skill_installs"
  ON public.skill_installs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Invocation audit log
CREATE TABLE public.skill_invocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  trigger_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  tools_called JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','partial','error')),
  reflection_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skill_invocations_user_time ON public.skill_invocations(user_id, created_at DESC);
CREATE INDEX idx_skill_invocations_skill ON public.skill_invocations(skill_id);

ALTER TABLE public.skill_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own invocations"
  ON public.skill_invocations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own invocations"
  ON public.skill_invocations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on skill_invocations"
  ON public.skill_invocations FOR ALL TO service_role
  USING (true) WITH CHECK (true);