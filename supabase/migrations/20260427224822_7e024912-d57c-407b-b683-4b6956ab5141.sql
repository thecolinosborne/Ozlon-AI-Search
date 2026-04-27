-- Ensure pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- email_attachments: parsed attachment records
CREATE TABLE IF NOT EXISTS public.email_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account_email TEXT,
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  thread_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  sender TEXT,
  sender_email TEXT,
  subject TEXT,
  received_at TIMESTAMP WITH TIME ZONE,
  extracted_text TEXT,
  summary TEXT,
  entities JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536),
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, message_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_user ON public.email_attachments(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_attachments_status ON public.email_attachments(status);
CREATE INDEX IF NOT EXISTS idx_email_attachments_embedding ON public.email_attachments USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.email_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own attachments" ON public.email_attachments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own attachments" ON public.email_attachments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own attachments" ON public.email_attachments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own attachments" ON public.email_attachments FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_email_attachments_updated_at
  BEFORE UPDATE ON public.email_attachments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- email_ingest_state: per-user polling cursor
CREATE TABLE IF NOT EXISTS public.email_ingest_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account_email TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_history_id TEXT,
  last_polled_at TIMESTAMP WITH TIME ZONE,
  last_message_date TIMESTAMP WITH TIME ZONE,
  filters JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, account_email)
);

ALTER TABLE public.email_ingest_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own ingest state" ON public.email_ingest_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own ingest state" ON public.email_ingest_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own ingest state" ON public.email_ingest_state FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own ingest state" ON public.email_ingest_state FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_email_ingest_state_updated_at
  BEFORE UPDATE ON public.email_ingest_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Semantic search function
CREATE OR REPLACE FUNCTION public.match_email_attachments(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  filter_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, filename text, sender text, subject text,
  received_at timestamp with time zone, summary text,
  extracted_text text, similarity double precision
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = extensions, public
AS $$
BEGIN
  RETURN QUERY
  SELECT ea.id, ea.filename, ea.sender, ea.subject, ea.received_at, ea.summary,
         ea.extracted_text,
         (1 - (ea.embedding <=> query_embedding))::float AS similarity
  FROM public.email_attachments ea
  WHERE ea.user_id = filter_user_id
    AND ea.embedding IS NOT NULL
    AND (1 - (ea.embedding <=> query_embedding)) > match_threshold
  ORDER BY ea.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;