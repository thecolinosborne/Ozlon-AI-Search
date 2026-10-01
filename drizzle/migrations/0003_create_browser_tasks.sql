CREATE TABLE public.browser_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal text NOT NULL,
  start_url text,
  status text NOT NULL DEFAULT 'queued',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  result text,
  pending_action jsonb,
  approved_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  question text,
  bb_session_id text,
  live_url text,
  context_id uuid,
  error text,
  step_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT, UPDATE ON public.browser_tasks TO authenticated;
GRANT ALL ON public.browser_tasks TO service_role;
ALTER TABLE public.browser_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own browser tasks read" ON public.browser_tasks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own browser tasks update" ON public.browser_tasks FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX browser_tasks_user_idx ON public.browser_tasks (user_id, created_at DESC);
CREATE TRIGGER browser_tasks_updated_at BEFORE UPDATE ON public.browser_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.browser_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL,
  domain text NOT NULL,
  bb_context_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sign_in_session_id text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, domain)
);
GRANT SELECT, DELETE ON public.browser_logins TO authenticated;
GRANT ALL ON public.browser_logins TO service_role;
ALTER TABLE public.browser_logins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own logins read" ON public.browser_logins FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own logins delete" ON public.browser_logins FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER browser_logins_updated_at BEFORE UPDATE ON public.browser_logins FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();