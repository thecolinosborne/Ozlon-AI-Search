CREATE UNIQUE INDEX IF NOT EXISTS idx_clickup_state_user_connection_unique
ON public.clickup_integration_state(user_id, connection_id)
WHERE user_id IS NOT NULL AND connection_id IS NOT NULL;