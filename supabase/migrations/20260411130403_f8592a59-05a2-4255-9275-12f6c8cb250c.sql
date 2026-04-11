
CREATE TABLE public.seo_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  site_url text NOT NULL,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  date_range_start date NOT NULL,
  date_range_end date NOT NULL,
  dimensions text[] NOT NULL DEFAULT '{}',
  data jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seo_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshots" ON public.seo_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own snapshots" ON public.seo_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own snapshots" ON public.seo_snapshots FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own snapshots" ON public.seo_snapshots FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_seo_snapshots_user_site ON public.seo_snapshots (user_id, site_url);
CREATE INDEX idx_seo_snapshots_date ON public.seo_snapshots (snapshot_date);
