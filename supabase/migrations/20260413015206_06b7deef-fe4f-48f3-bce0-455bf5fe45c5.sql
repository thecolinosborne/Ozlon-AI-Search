
-- Create work_tasks table
-- user_id references auth.users(id). No FK to avoid cross-schema issues.
CREATE TABLE public.work_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'up_for_review', 'completed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  task_type TEXT NOT NULL DEFAULT 'general' CHECK (task_type IN ('general', 'email', 'research', 'content', 'outreach', 'ops', 'creative')),
  intent_type TEXT NOT NULL DEFAULT 'ops' CHECK (intent_type IN ('ops', 'lead_gen', 'fulfillment', 'content', 'research', 'outreach', 'admin')),
  assigned_to TEXT DEFAULT 'ai',
  next_action TEXT NOT NULL DEFAULT 'waiting_on_ai' CHECK (next_action IN ('waiting_on_ai', 'waiting_on_human', 'ready_to_send', 'needs_review', 'blocked', 'none')),
  ai_status TEXT NOT NULL DEFAULT 'idle' CHECK (ai_status IN ('idle', 'thinking', 'executing', 'waiting', 'error')),
  board_position INTEGER NOT NULL DEFAULT 0,
  draft_output TEXT,
  revision_notes TEXT,
  final_deliverable TEXT,
  ai_activity_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  comments JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_chat_session_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  archived_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own work tasks"
  ON public.work_tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own work tasks"
  ON public.work_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own work tasks"
  ON public.work_tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own work tasks"
  ON public.work_tasks FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on work tasks"
  ON public.work_tasks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at trigger (reuse existing function)
CREATE TRIGGER update_work_tasks_updated_at
  BEFORE UPDATE ON public.work_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- completed_at trigger: auto-set/clear based on status
CREATE OR REPLACE FUNCTION public.set_work_task_completed_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    NEW.completed_at = now();
  ELSIF NEW.status <> 'completed' AND OLD.status = 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_work_tasks_completed_at
  BEFORE UPDATE ON public.work_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_work_task_completed_at();

-- Indexes
CREATE INDEX idx_work_tasks_user_status ON public.work_tasks (user_id, status);
CREATE INDEX idx_work_tasks_user_archive_status ON public.work_tasks (user_id, archived_at, status);
CREATE INDEX idx_work_tasks_user_activity ON public.work_tasks (user_id, last_activity_at DESC);
CREATE INDEX idx_work_tasks_source_chat ON public.work_tasks (source_chat_session_id);
