-- ============================================================
-- INTEGRATION HUB FOUNDATION (Credentials + Sync Runs)
-- ============================================================
-- Notes:
-- - This schema stores connection metadata only.
-- - Secrets (API keys / OAuth refresh tokens) should live in a secure vault.
-- - credential_ref should point to a backend-managed secret reference.

CREATE TABLE public.integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  auth_type text NOT NULL,
  credential_ref text,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'disconnected',
  external_account_id text,
  external_account_label text,
  last_validated_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_connections_provider_check
    CHECK (provider IN ('youtube','clickup','maton','descript','gohighlevel','higgsfield','ai_processor','custom')),
  CONSTRAINT integration_connections_auth_type_check
    CHECK (auth_type IN ('api_key','oauth2','service_account')),
  CONSTRAINT integration_connections_status_check
    CHECK (status IN ('connected','disconnected','syncing','error'))
);

CREATE UNIQUE INDEX uq_integration_connections_user_provider_account
  ON public.integration_connections (user_id, provider, auth_type, COALESCE(external_account_id, 'primary'));

CREATE INDEX idx_integration_connections_user_provider
  ON public.integration_connections (user_id, provider);

CREATE INDEX idx_integration_connections_status
  ON public.integration_connections (status, provider);

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own integration connections"
  ON public.integration_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own integration connections"
  ON public.integration_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own integration connections"
  ON public.integration_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own integration connections"
  ON public.integration_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on integration connections"
  ON public.integration_connections FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_integration_connections_updated_at
  BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Sync execution log (observability + retries)
-- ============================================================
CREATE TABLE public.integration_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  sync_type text NOT NULL DEFAULT 'manual',
  direction text NOT NULL DEFAULT 'inbound',
  status text NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  records_processed integer NOT NULL DEFAULT 0,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_sync_runs_sync_type_check
    CHECK (sync_type IN ('manual','scheduled','webhook','initial')),
  CONSTRAINT integration_sync_runs_direction_check
    CHECK (direction IN ('inbound','outbound','two-way')),
  CONSTRAINT integration_sync_runs_status_check
    CHECK (status IN ('queued','running','succeeded','failed','partial'))
);

CREATE INDEX idx_integration_sync_runs_connection_created
  ON public.integration_sync_runs (connection_id, created_at DESC);

CREATE INDEX idx_integration_sync_runs_user_status
  ON public.integration_sync_runs (user_id, status, created_at DESC);

ALTER TABLE public.integration_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own integration sync runs"
  ON public.integration_sync_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own integration sync runs"
  ON public.integration_sync_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own integration sync runs"
  ON public.integration_sync_runs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own integration sync runs"
  ON public.integration_sync_runs FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on integration sync runs"
  ON public.integration_sync_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
