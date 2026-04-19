BEGIN;

DROP POLICY IF EXISTS "Users can insert own clickup state" ON public.clickup_integration_state;
DROP POLICY IF EXISTS "Users can update own clickup state" ON public.clickup_integration_state;

CREATE POLICY "Users can insert own clickup state"
ON public.clickup_integration_state
FOR INSERT
TO authenticated
WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "Users can update own clickup state"
ON public.clickup_integration_state
FOR UPDATE
TO authenticated
USING (user_id IS NOT NULL AND auth.uid() = user_id)
WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

COMMIT;