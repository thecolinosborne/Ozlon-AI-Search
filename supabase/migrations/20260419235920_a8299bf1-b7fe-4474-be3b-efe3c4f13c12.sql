ALTER TABLE public.work_tasks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_work_tasks_deleted_at ON public.work_tasks (user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_deleted_at ON public.chat_sessions (user_id, deleted_at);