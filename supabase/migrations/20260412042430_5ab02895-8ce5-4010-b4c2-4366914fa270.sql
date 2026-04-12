CREATE TABLE public.descript_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  project_id text NOT NULL,
  job_id text NOT NULL UNIQUE,
  job_type text NOT NULL DEFAULT 'import',
  status text NOT NULL DEFAULT 'pending',
  input_prompt text,
  output_data jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.descript_jobs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_descript_jobs_updated_at
  BEFORE UPDATE ON public.descript_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();