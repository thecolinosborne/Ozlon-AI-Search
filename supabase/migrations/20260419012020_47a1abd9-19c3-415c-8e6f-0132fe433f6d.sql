-- Backfill descript_jobs.user_id from the owner's descript connection where possible
UPDATE public.descript_jobs dj
SET user_id = ic.user_id
FROM public.integration_connections ic
WHERE dj.user_id IS NULL
  AND ic.provider = 'descript'
  AND ic.status = 'connected'
  AND (
    SELECT COUNT(*) FROM public.integration_connections ic2
    WHERE ic2.provider = 'descript' AND ic2.status = 'connected'
  ) = 1;

-- Index to make per-user job lookups fast
CREATE INDEX IF NOT EXISTS idx_descript_jobs_user_id ON public.descript_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_descript_jobs_user_job ON public.descript_jobs(user_id, job_id);