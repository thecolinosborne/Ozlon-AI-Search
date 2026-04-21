CREATE TABLE public.search_atlas_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  domain TEXT,
  project_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_search_atlas_snapshots_user_kind_domain
  ON public.search_atlas_snapshots(user_id, kind, domain, fetched_at DESC);

ALTER TABLE public.search_atlas_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own search atlas snapshots"
  ON public.search_atlas_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own search atlas snapshots"
  ON public.search_atlas_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own search atlas snapshots"
  ON public.search_atlas_snapshots FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own search atlas snapshots"
  ON public.search_atlas_snapshots FOR DELETE
  USING (auth.uid() = user_id);