
-- clickup_integration_state: service-role only
CREATE POLICY "Service role full access on clickup_integration_state"
ON public.clickup_integration_state
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- clickup_processed_comments: service-role only
CREATE POLICY "Service role full access on clickup_processed_comments"
ON public.clickup_processed_comments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- descript_jobs: service-role only + users can view their own jobs
CREATE POLICY "Service role full access on descript_jobs"
ON public.descript_jobs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Users can view own descript jobs"
ON public.descript_jobs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
