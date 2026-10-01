ALTER TABLE public.browser_tasks ADD COLUMN IF NOT EXISTS executor text NOT NULL DEFAULT 'cloud';
ALTER TABLE public.browser_tasks ADD COLUMN IF NOT EXISTS device_id uuid;

CREATE TABLE public.browser_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Chrome',
  token_hash text,
  pair_code text,
  pair_expires_at timestamptz,
  last_seen_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.browser_devices TO authenticated;
GRANT ALL ON public.browser_devices TO service_role;
ALTER TABLE public.browser_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own devices read" ON public.browser_devices FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own devices delete" ON public.browser_devices FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX browser_devices_token_idx ON public.browser_devices(token_hash);
CREATE INDEX browser_devices_code_idx ON public.browser_devices(pair_code);