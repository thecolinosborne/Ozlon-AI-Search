
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_connections_unique_provider
ON public.integration_connections (user_id, provider, auth_type, (COALESCE(external_account_id, '__null__')));
