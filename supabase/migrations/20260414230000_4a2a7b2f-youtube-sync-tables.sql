-- ============================================================
-- YOUTUBE SYNC TABLES
-- ============================================================

CREATE TABLE public.youtube_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  title text,
  description text,
  thumbnail_url text,
  subscriber_count bigint,
  video_count bigint,
  view_count bigint,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_youtube_channels_user_channel UNIQUE (user_id, channel_id)
);

CREATE INDEX idx_youtube_channels_connection ON public.youtube_channels (connection_id);
CREATE INDEX idx_youtube_channels_user_updated ON public.youtube_channels (user_id, updated_at DESC);

ALTER TABLE public.youtube_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own youtube channels"
  ON public.youtube_channels FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own youtube channels"
  ON public.youtube_channels FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own youtube channels"
  ON public.youtube_channels FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own youtube channels"
  ON public.youtube_channels FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on youtube channels"
  ON public.youtube_channels FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_youtube_channels_updated_at
  BEFORE UPDATE ON public.youtube_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.youtube_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  video_id text NOT NULL,
  title text,
  description text,
  published_at timestamptz,
  thumbnail_url text,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_youtube_videos_user_video UNIQUE (user_id, video_id)
);

CREATE INDEX idx_youtube_videos_connection ON public.youtube_videos (connection_id);
CREATE INDEX idx_youtube_videos_channel_published ON public.youtube_videos (channel_id, published_at DESC);
CREATE INDEX idx_youtube_videos_user_updated ON public.youtube_videos (user_id, updated_at DESC);

ALTER TABLE public.youtube_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own youtube videos"
  ON public.youtube_videos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own youtube videos"
  ON public.youtube_videos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own youtube videos"
  ON public.youtube_videos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own youtube videos"
  ON public.youtube_videos FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on youtube videos"
  ON public.youtube_videos FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_youtube_videos_updated_at
  BEFORE UPDATE ON public.youtube_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
