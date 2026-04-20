ALTER TABLE public.knowledge_sources 
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_user_active 
ON public.knowledge_sources(user_id, is_active);