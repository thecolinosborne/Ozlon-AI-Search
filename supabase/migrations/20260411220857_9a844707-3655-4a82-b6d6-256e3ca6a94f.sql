
CREATE TABLE public.facebook_ads_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id text,
  campaign_name text,
  status text,
  objective text,
  spend numeric,
  impressions bigint,
  clicks bigint,
  cpc numeric,
  ctr numeric,
  reach bigint,
  date_start date,
  date_stop date,
  raw_json jsonb DEFAULT '{}'::jsonb,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.facebook_ads_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own facebook ads"
  ON public.facebook_ads_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own facebook ads"
  ON public.facebook_ads_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own facebook ads"
  ON public.facebook_ads_cache FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_facebook_ads_cache_user_id ON public.facebook_ads_cache(user_id);
CREATE INDEX idx_facebook_ads_cache_campaign_id ON public.facebook_ads_cache(campaign_id);
