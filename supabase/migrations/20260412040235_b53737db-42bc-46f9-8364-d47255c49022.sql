-- Idempotency table: prevents duplicate webhook processing
CREATE TABLE public.clickup_processed_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id text UNIQUE NOT NULL,
  task_id text NOT NULL,
  event_type text,
  status text NOT NULL DEFAULT 'processed',
  response_comment_id text,
  error_message text,
  handled_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.clickup_processed_comments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_clickup_processed_task ON public.clickup_processed_comments(task_id);
CREATE INDEX idx_clickup_processed_handled ON public.clickup_processed_comments(handled_at);

-- Integration state / config table
CREATE TABLE public.clickup_integration_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL,
  default_list_id text,
  webhook_id text,
  webhook_status text DEFAULT 'not_registered',
  auto_reply_enabled boolean DEFAULT true,
  reply_trigger_mode text DEFAULT 'mention_only',
  ai_reply_mode text DEFAULT 'standard',
  allow_subtask_creation boolean DEFAULT false,
  allow_task_updates boolean DEFAULT false,
  max_reply_length integer DEFAULT 2000,
  cooldown_seconds integer DEFAULT 30,
  last_tested_at timestamptz,
  last_webhook_event_at timestamptz,
  last_successful_ai_reply_at timestamptz,
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.clickup_integration_state ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_clickup_state_team ON public.clickup_integration_state(team_id);

-- Auto-update updated_at
CREATE TRIGGER update_clickup_integration_state_updated_at
BEFORE UPDATE ON public.clickup_integration_state
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();