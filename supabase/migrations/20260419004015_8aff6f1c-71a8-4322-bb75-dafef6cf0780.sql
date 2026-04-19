UPDATE public.clickup_integration_state cis
SET user_id = ic.user_id,
    connection_id = ic.id
FROM public.integration_connections ic
WHERE ic.provider = 'clickup'
  AND ic.status = 'connected'
  AND cis.team_id = COALESCE(ic.external_account_id, cis.team_id)
  AND (cis.user_id IS NULL OR cis.connection_id IS NULL);