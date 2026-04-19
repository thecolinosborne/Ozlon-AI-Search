BEGIN;

ALTER TABLE public.clickup_integration_state
  ADD COLUMN IF NOT EXISTS connection_id uuid;

UPDATE public.clickup_integration_state cis
SET user_id = ic.user_id,
    connection_id = ic.id
FROM public.integration_connections ic
WHERE ic.provider = 'clickup'
  AND ic.status = 'connected'
  AND ic.external_account_id IS NOT DISTINCT FROM cis.team_id
  AND (cis.user_id IS NULL OR cis.connection_id IS NULL);

UPDATE public.clickup_integration_state cis
SET user_id = ic.user_id,
    connection_id = ic.id
FROM (
  SELECT DISTINCT ON (user_id) id, user_id
  FROM public.integration_connections
  WHERE provider = 'clickup'
    AND status = 'connected'
  ORDER BY user_id, updated_at DESC
) ic
WHERE (cis.user_id IS NULL OR cis.connection_id IS NULL);

ALTER TABLE public.clickup_integration_state
  DROP CONSTRAINT IF EXISTS clickup_integration_state_team_id_key;

DROP INDEX IF EXISTS public.clickup_integration_state_team_id_key;

ALTER TABLE public.clickup_integration_state
  ADD CONSTRAINT clickup_integration_state_connection_id_fkey
  FOREIGN KEY (connection_id)
  REFERENCES public.integration_connections(id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clickup_state_user_team_unique
  ON public.clickup_integration_state(user_id, team_id)
  WHERE user_id IS NOT NULL AND team_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clickup_state_connection_unique
  ON public.clickup_integration_state(connection_id)
  WHERE connection_id IS NOT NULL;

DROP POLICY IF EXISTS "Users can view own clickup state" ON public.clickup_integration_state;

CREATE POLICY "Users can view own clickup state"
ON public.clickup_integration_state
FOR SELECT
USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "Users can insert own clickup state"
ON public.clickup_integration_state
FOR INSERT
WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "Users can update own clickup state"
ON public.clickup_integration_state
FOR UPDATE
USING (user_id IS NOT NULL AND auth.uid() = user_id)
WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

COMMIT;