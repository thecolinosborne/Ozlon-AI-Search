-- skill_assets: bundled reference files (instructions, examples, references)
CREATE TABLE public.skill_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/plain',
  content_text TEXT,
  storage_path TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (skill_id, path)
);

ALTER TABLE public.skill_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own skill assets"
  ON public.skill_assets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own skill assets"
  ON public.skill_assets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete their own skill assets"
  ON public.skill_assets FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_skill_assets_skill ON public.skill_assets(skill_id);

-- skill_snapshots: audit trail of what was installed and what the scan said
CREATE TABLE public.skill_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  manifest_snapshot JSONB NOT NULL,
  scan_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  autofixes_applied JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_format TEXT,
  reason TEXT NOT NULL DEFAULT 'install',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.skill_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own skill snapshots"
  ON public.skill_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own skill snapshots"
  ON public.skill_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_skill_snapshots_skill ON public.skill_snapshots(skill_id, created_at DESC);

-- Private storage bucket for large skill bundle files
INSERT INTO storage.buckets (id, name, public)
VALUES ('skill-assets', 'skill-assets', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read their own skill asset files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'skill-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload their own skill asset files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'skill-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete their own skill asset files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'skill-assets' AND auth.uid()::text = (storage.foldername(name))[1]);