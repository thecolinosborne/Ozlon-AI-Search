
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Knowledge sources table
CREATE TABLE public.knowledge_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  person TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'book',
  entry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own knowledge sources" ON public.knowledge_sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own knowledge sources" ON public.knowledge_sources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own knowledge sources" ON public.knowledge_sources FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own knowledge sources" ON public.knowledge_sources FOR DELETE USING (auth.uid() = user_id);

-- Knowledge entries table
CREATE TABLE public.knowledge_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_id UUID REFERENCES public.knowledge_sources(id) ON DELETE SET NULL,
  source_person TEXT NOT NULL,
  source_material TEXT,
  category TEXT NOT NULL DEFAULT 'principle',
  domain TEXT NOT NULL DEFAULT 'mindset',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding extensions.vector(1536),
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own knowledge entries" ON public.knowledge_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own knowledge entries" ON public.knowledge_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own knowledge entries" ON public.knowledge_entries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own knowledge entries" ON public.knowledge_entries FOR DELETE USING (auth.uid() = user_id);

-- Index for vector similarity search
CREATE INDEX knowledge_entries_embedding_idx ON public.knowledge_entries USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);

-- Index for filtering
CREATE INDEX knowledge_entries_user_id_idx ON public.knowledge_entries (user_id);
CREATE INDEX knowledge_entries_domain_idx ON public.knowledge_entries (domain);
CREATE INDEX knowledge_entries_category_idx ON public.knowledge_entries (category);

-- Timestamp trigger
CREATE TRIGGER update_knowledge_entries_updated_at
BEFORE UPDATE ON public.knowledge_entries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Semantic search function
CREATE OR REPLACE FUNCTION public.match_knowledge(
  query_embedding extensions.vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  filter_user_id UUID DEFAULT NULL,
  filter_domain TEXT DEFAULT NULL,
  filter_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_person TEXT,
  source_material TEXT,
  category TEXT,
  domain TEXT,
  title TEXT,
  content TEXT,
  tags TEXT[],
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ke.id,
    ke.source_person,
    ke.source_material,
    ke.category,
    ke.domain,
    ke.title,
    ke.content,
    ke.tags,
    1 - (ke.embedding <=> query_embedding)::FLOAT AS similarity
  FROM public.knowledge_entries ke
  WHERE ke.user_id = filter_user_id
    AND 1 - (ke.embedding <=> query_embedding) > match_threshold
    AND (filter_domain IS NULL OR ke.domain = filter_domain)
    AND (filter_category IS NULL OR ke.category = filter_category)
  ORDER BY ke.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
