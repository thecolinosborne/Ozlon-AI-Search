CREATE TABLE IF NOT EXISTS public.youtube_competitor_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  handle TEXT NOT NULL,
  channel_id TEXT,
  payload JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'youtube_api',
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS youtube_competitor_cache_handle_source_idx
  ON public.youtube_competitor_cache (lower(handle), source);

CREATE INDEX IF NOT EXISTS youtube_competitor_cache_channel_idx
  ON public.youtube_competitor_cache (channel_id);

ALTER TABLE public.youtube_competitor_cache ENABLE ROW LEVEL SECURITY;
-- No policies: only service role (used by edge functions) can read/write.