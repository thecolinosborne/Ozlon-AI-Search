DELETE FROM public.clickup_integration_state
WHERE user_id IS NULL
   OR connection_id IS NULL;