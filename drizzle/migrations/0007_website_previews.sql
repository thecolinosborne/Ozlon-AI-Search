CREATE TABLE public.website_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL,
  domain text NOT NULL,
  business_name text,
  html text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  ip_hash text,
  lead_name text,
  lead_email text,
  lead_phone text,
  lead_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.website_previews TO service_role;
ALTER TABLE public.website_previews ENABLE ROW LEVEL SECURITY;
CREATE INDEX website_previews_domain_idx ON public.website_previews(domain, created_at DESC);
CREATE INDEX website_previews_ip_idx ON public.website_previews(ip_hash, created_at DESC);