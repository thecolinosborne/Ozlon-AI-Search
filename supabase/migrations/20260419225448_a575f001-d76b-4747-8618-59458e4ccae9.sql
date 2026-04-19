-- 1. Extend chat_sessions to act as unified threads
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS goal text,
  ADD COLUMN IF NOT EXISTS task_status text,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS current_artifact_id uuid,
  ADD COLUMN IF NOT EXISTS linked_work_task_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_kind_check;
ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_kind_check
  CHECK (kind IN ('chat','task','both'));

CREATE INDEX IF NOT EXISTS idx_chat_sessions_kind ON public.chat_sessions(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_task_status ON public.chat_sessions(user_id, task_status) WHERE kind IN ('task','both');

-- 2. Artifacts table (typed, versioned deliverables)
CREATE TABLE IF NOT EXISTS public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  type text NOT NULL,
  title text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_by text NOT NULL DEFAULT 'ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_type_check CHECK (type IN (
    'markdown','email_draft','doc_link','image','file','checklist','decision','action_result','plan'
  )),
  CONSTRAINT artifacts_status_check CHECK (status IN ('draft','approved','published','archived')),
  CONSTRAINT artifacts_created_by_check CHECK (created_by IN ('ai','user'))
);

CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON public.artifacts(conversation_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_user ON public.artifacts(user_id, created_at DESC);

ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own artifacts"
  ON public.artifacts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own artifacts"
  ON public.artifacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own artifacts"
  ON public.artifacts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own artifacts"
  ON public.artifacts FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on artifacts"
  ON public.artifacts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_artifacts_updated_at
  BEFORE UPDATE ON public.artifacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Task events (autonomous activity log)
CREATE TABLE IF NOT EXISTS public.task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_events_conversation ON public.task_events(conversation_id, created_at DESC);

ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own task events"
  ON public.task_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on task events"
  ON public.task_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.artifacts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_sessions;

ALTER TABLE public.artifacts REPLICA IDENTITY FULL;
ALTER TABLE public.task_events REPLICA IDENTITY FULL;
ALTER TABLE public.chat_sessions REPLICA IDENTITY FULL;

-- 5. Backfill: create a unified thread for every existing work_task
INSERT INTO public.chat_sessions (
  id, user_id, title, kind, goal, task_status, priority,
  linked_work_task_id, metadata, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  wt.user_id,
  wt.title,
  'task',
  wt.title,
  CASE wt.status
    WHEN 'completed' THEN 'done'
    WHEN 'up_for_review' THEN 'awaiting_user'
    WHEN 'in_progress' THEN 'working'
    ELSE 'awaiting_user'
  END,
  wt.priority,
  wt.id,
  jsonb_build_object('source','work_tasks_backfill','task_type', wt.task_type, 'intent_type', wt.intent_type),
  wt.created_at,
  wt.updated_at
FROM public.work_tasks wt
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_sessions cs WHERE cs.linked_work_task_id = wt.id
);