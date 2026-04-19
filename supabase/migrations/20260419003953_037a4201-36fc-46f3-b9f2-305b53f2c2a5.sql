DELETE FROM public.clickup_integration_state cis
WHERE NOT EXISTS (
  SELECT 1
  FROM public.integration_connections ic
  WHERE ic.id = cis.connection_id
    AND ic.user_id = cis.user_id
    AND ic.provider = 'clickup'
);