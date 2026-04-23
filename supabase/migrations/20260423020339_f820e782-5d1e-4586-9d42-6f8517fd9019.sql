-- Add email signature for Gmail replies and a send outbox for retries
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_signature text;

CREATE TABLE IF NOT EXISTS public.communications_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel text NOT NULL,
  source text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count int NOT NULL DEFAULT 0,
  last_error text,
  in_reply_to_external_id text,
  thread_external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

ALTER TABLE public.communications_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outbox owner select" ON public.communications_outbox
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "outbox owner insert" ON public.communications_outbox
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outbox owner update" ON public.communications_outbox
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "outbox owner delete" ON public.communications_outbox
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_outbox_user_status
  ON public.communications_outbox (user_id, status, created_at DESC);

CREATE TRIGGER trg_outbox_updated_at
  BEFORE UPDATE ON public.communications_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();