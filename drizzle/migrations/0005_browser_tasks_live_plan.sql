ALTER TABLE public.browser_tasks ADD COLUMN IF NOT EXISTS plan jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.browser_tasks ADD COLUMN IF NOT EXISTS plan_index integer NOT NULL DEFAULT 0;
ALTER TABLE public.browser_tasks ADD COLUMN IF NOT EXISTS narration text;
ALTER TABLE public.browser_tasks ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'thinking';