-- integration_connections: generic per-user provider connections
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'api_key',
  credential_ref TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  external_account_id TEXT,
  external_account_label TEXT,
  last_validated_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, auth_type, external_account_id)
);

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own connections"
  ON public.integration_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own connections"
  ON public.integration_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own connections"
  ON public.integration_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own connections"
  ON public.integration_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_integration_connections_updated_at
  BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- integration_sync_runs: append-only run log
CREATE TABLE IF NOT EXISTS public.integration_sync_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL DEFAULT 'manual',
  direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  records_processed INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sync runs"
  ON public.integration_sync_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sync runs"
  ON public.integration_sync_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sync runs"
  ON public.integration_sync_runs FOR UPDATE
  USING (auth.uid() = user_id);

-- youtube_channels: synced channel metadata
CREATE TABLE IF NOT EXISTS public.youtube_channels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  subscriber_count BIGINT DEFAULT 0,
  video_count BIGINT DEFAULT 0,
  view_count BIGINT DEFAULT 0,
  raw JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel_id)
);

ALTER TABLE public.youtube_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own channels"
  ON public.youtube_channels FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own channels"
  ON public.youtube_channels FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own channels"
  ON public.youtube_channels FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_youtube_channels_updated_at
  BEFORE UPDATE ON public.youtube_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- youtube_videos: synced video metadata
CREATE TABLE IF NOT EXISTS public.youtube_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  published_at TIMESTAMPTZ,
  thumbnail_url TEXT,
  view_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  raw JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);

ALTER TABLE public.youtube_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own videos"
  ON public.youtube_videos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own videos"
  ON public.youtube_videos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own videos"
  ON public.youtube_videos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_youtube_videos_updated_at
  BEFORE UPDATE ON public.youtube_videos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();