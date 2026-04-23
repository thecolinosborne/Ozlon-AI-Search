-- Communications inbox cache
CREATE TABLE public.communications_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  source text NOT NULL,
  channel text NOT NULL,
  external_id text NOT NULL,
  thread_external_id text,
  from_name text,
  from_handle text,
  channel_label text,
  subject text,
  preview text,
  body_text text,
  audio_url text,
  duration_sec integer,
  received_at timestamptz NOT NULL,
  is_unread boolean NOT NULL DEFAULT false,
  needs_reply boolean NOT NULL DEFAULT false,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communications_messages_unique UNIQUE (user_id, source, external_id)
);

CREATE INDEX idx_comm_msgs_user_received ON public.communications_messages (user_id, received_at DESC);
CREATE INDEX idx_comm_msgs_user_channel ON public.communications_messages (user_id, channel);

ALTER TABLE public.communications_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own comm messages"
  ON public.communications_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own comm messages"
  ON public.communications_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own comm messages"
  ON public.communications_messages FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own comm messages"
  ON public.communications_messages FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on comm messages"
  ON public.communications_messages FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER communications_messages_updated_at
  BEFORE UPDATE ON public.communications_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.communications_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.communications_messages;

-- Per-user read/snooze/archive state
CREATE TABLE public.communications_read_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  message_key text NOT NULL,
  read_at timestamptz,
  snoozed_until timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communications_read_state_unique UNIQUE (user_id, message_key)
);

CREATE INDEX idx_comm_read_user ON public.communications_read_state (user_id);

ALTER TABLE public.communications_read_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own read state"
  ON public.communications_read_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own read state"
  ON public.communications_read_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own read state"
  ON public.communications_read_state FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own read state"
  ON public.communications_read_state FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on read state"
  ON public.communications_read_state FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER communications_read_state_updated_at
  BEFORE UPDATE ON public.communications_read_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();