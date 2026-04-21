
-- 1.1 integration_credentials write policies
CREATE POLICY "Users insert own credentials"
ON public.integration_credentials FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own credentials"
ON public.integration_credentials FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own credentials"
ON public.integration_credentials FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- 1.2 credential_audit_log policies
CREATE POLICY "Users insert own audit entries"
ON public.credential_audit_log FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages audit entries"
ON public.credential_audit_log FOR DELETE TO service_role
USING (true);

-- 3.1 Dedupe integration_connections (keep newest per user+provider+connected)
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id, provider ORDER BY updated_at DESC, created_at DESC) AS rn
  FROM public.integration_connections
  WHERE status = 'connected'
)
DELETE FROM public.integration_connections ic
USING ranked
WHERE ic.id = ranked.id AND ranked.rn > 1;

-- Partial unique index: only one connected row per (user, provider)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_integration_connection_active
ON public.integration_connections (user_id, provider)
WHERE status = 'connected';
