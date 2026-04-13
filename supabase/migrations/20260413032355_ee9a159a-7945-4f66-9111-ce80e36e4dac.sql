
-- Video tasks table: strict 1:1 extension of work_tasks
CREATE TABLE public.video_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_task_id uuid NOT NULL UNIQUE REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'prompt'
    CHECK (source_type IN ('prompt','transcript','script','blog_post','video_url','notes')),
  source_content text,
  source_asset_url text,
  requested_output text NOT NULL DEFAULT 'short_form'
    CHECK (requested_output IN ('short_form','promo','highlight_clips','talking_head','custom')),
  edit_instructions text,
  edit_plan jsonb NOT NULL DEFAULT '[]',
  edit_plan_status text NOT NULL DEFAULT 'not_generated'
    CHECK (edit_plan_status IN ('not_generated','generated','approved','stale')),
  aspect_ratio text NOT NULL DEFAULT '9:16'
    CHECK (aspect_ratio IN ('16:9','9:16','1:1')),
  target_duration integer CHECK (target_duration > 0),
  render_status text NOT NULL DEFAULT 'pending'
    CHECK (render_status IN ('pending','queued','rendering','completed','failed')),
  render_progress integer NOT NULL DEFAULT 0
    CHECK (render_progress >= 0 AND render_progress <= 100),
  output_url text,
  thumbnail_url text,
  render_history jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Document the 1:1 intent
COMMENT ON COLUMN public.video_tasks.work_task_id IS 'Strict 1:1 extension of a parent work_task. Each work_task has at most one video_task.';

-- Indexes
CREATE INDEX idx_video_tasks_user_render ON public.video_tasks(user_id, render_status);

-- RLS
ALTER TABLE public.video_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own video tasks"
  ON public.video_tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own video tasks"
  ON public.video_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own video tasks"
  ON public.video_tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own video tasks"
  ON public.video_tasks FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on video tasks"
  ON public.video_tasks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Auto-update trigger
CREATE TRIGGER update_video_tasks_updated_at
  BEFORE UPDATE ON public.video_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
