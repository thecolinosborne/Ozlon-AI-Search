CREATE TABLE public.ventures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  slug text,
  description text,
  stage text NOT NULL DEFAULT 'building',
  what_exists text,
  who_works_here text,
  clickup_list_id text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ventures TO authenticated;
GRANT ALL ON public.ventures TO service_role;
ALTER TABLE public.ventures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ventures_select_own" ON public.ventures FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ventures_insert_own" ON public.ventures FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ventures_update_own" ON public.ventures FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ventures_delete_own" ON public.ventures FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX ventures_user_idx ON public.ventures (user_id, is_active);
CREATE TRIGGER ventures_updated_at BEFORE UPDATE ON public.ventures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.outcome_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  venture_id uuid REFERENCES public.ventures(id) ON DELETE SET NULL,
  title text NOT NULL,
  goal text NOT NULL,
  success_looks_like text[] NOT NULL DEFAULT '{}',
  done_when text[] NOT NULL DEFAULT '{}',
  current_state text,
  first_move text,
  owner text,
  due_date date,
  status text NOT NULL DEFAULT 'draft',
  clickup_task_id text,
  clickup_list_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outcome_specs TO authenticated;
GRANT ALL ON public.outcome_specs TO service_role;
ALTER TABLE public.outcome_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outcome_specs_select_own" ON public.outcome_specs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "outcome_specs_insert_own" ON public.outcome_specs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outcome_specs_update_own" ON public.outcome_specs FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "outcome_specs_delete_own" ON public.outcome_specs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX outcome_specs_user_idx ON public.outcome_specs (user_id, status);
CREATE TRIGGER outcome_specs_updated_at BEFORE UPDATE ON public.outcome_specs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.outcome_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  outcome_id uuid NOT NULL REFERENCES public.outcome_specs(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  detail text,
  owner text,
  due_date date,
  status text NOT NULL DEFAULT 'open',
  clickup_task_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outcome_steps TO authenticated;
GRANT ALL ON public.outcome_steps TO service_role;
ALTER TABLE public.outcome_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outcome_steps_select_own" ON public.outcome_steps FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "outcome_steps_insert_own" ON public.outcome_steps FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outcome_steps_update_own" ON public.outcome_steps FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "outcome_steps_delete_own" ON public.outcome_steps FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX outcome_steps_outcome_idx ON public.outcome_steps (outcome_id, position);
CREATE TRIGGER outcome_steps_updated_at BEFORE UPDATE ON public.outcome_steps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();