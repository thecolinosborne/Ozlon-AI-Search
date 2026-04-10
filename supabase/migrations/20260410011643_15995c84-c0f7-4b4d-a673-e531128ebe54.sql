
-- ============================================================
-- WISDOM ENGINE SCHEMA
-- ============================================================

-- 1. wisdom_memories
CREATE TABLE public.wisdom_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  memory_type text NOT NULL DEFAULT 'fact',
  content text NOT NULL,
  summary text,
  embedding extensions.vector(1536),
  salience float DEFAULT 0.5,
  confidence float DEFAULT 0.8,
  recurrence_count int DEFAULT 1,
  last_accessed_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.wisdom_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own memories" ON public.wisdom_memories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own memories" ON public.wisdom_memories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own memories" ON public.wisdom_memories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own memories" ON public.wisdom_memories FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_wisdom_memories_user ON public.wisdom_memories(user_id);
CREATE INDEX idx_wisdom_memories_type ON public.wisdom_memories(user_id, memory_type);
CREATE INDEX idx_wisdom_memories_updated ON public.wisdom_memories(updated_at DESC);

CREATE TRIGGER update_wisdom_memories_updated_at
  BEFORE UPDATE ON public.wisdom_memories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. reflection_notes
CREATE TABLE public.reflection_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_ids jsonb DEFAULT '[]'::jsonb,
  note_type text NOT NULL DEFAULT 'insight',
  content text NOT NULL,
  embedding extensions.vector(1536),
  importance float DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.reflection_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reflections" ON public.reflection_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reflections" ON public.reflection_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reflections" ON public.reflection_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own reflections" ON public.reflection_notes FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_reflection_notes_user ON public.reflection_notes(user_id);
CREATE INDEX idx_reflection_notes_created ON public.reflection_notes(created_at DESC);

-- 3. chat_sessions
CREATE TABLE public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions" ON public.chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON public.chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.chat_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON public.chat_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_chat_sessions_user ON public.chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_updated ON public.chat_sessions(updated_at DESC);

CREATE TRIGGER update_chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. chat_messages
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  embedding extensions.vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages" ON public.chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own messages" ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own messages" ON public.chat_messages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_chat_messages_session ON public.chat_messages(session_id, created_at);
CREATE INDEX idx_chat_messages_user ON public.chat_messages(user_id);

-- 5. system_evolution_proposals
CREATE TABLE public.system_evolution_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  proposal_type text NOT NULL DEFAULT 'prompt_refinement',
  title text NOT NULL,
  description text NOT NULL,
  patch_text text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.system_evolution_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own proposals" ON public.system_evolution_proposals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own proposals" ON public.system_evolution_proposals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own proposals" ON public.system_evolution_proposals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own proposals" ON public.system_evolution_proposals FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_evolution_proposals_user ON public.system_evolution_proposals(user_id);
CREATE INDEX idx_evolution_proposals_status ON public.system_evolution_proposals(user_id, status);

-- ============================================================
-- VECTOR SIMILARITY SEARCH FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_wisdom_memories(
  query_embedding extensions.vector,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  filter_user_id uuid DEFAULT NULL,
  filter_memory_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  memory_type text,
  content text,
  summary text,
  salience float,
  confidence float,
  recurrence_count int,
  last_accessed_at timestamptz,
  updated_at timestamptz,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wm.id, wm.memory_type, wm.content, wm.summary,
    wm.salience, wm.confidence, wm.recurrence_count,
    wm.last_accessed_at, wm.updated_at, wm.metadata,
    (1 - (wm.embedding <=> query_embedding))::float AS similarity
  FROM public.wisdom_memories wm
  WHERE wm.user_id = filter_user_id
    AND (1 - (wm.embedding <=> query_embedding)) > match_threshold
    AND (filter_memory_type IS NULL OR wm.memory_type = filter_memory_type)
  ORDER BY wm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_reflections(
  query_embedding extensions.vector,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  filter_user_id uuid DEFAULT NULL,
  filter_note_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  note_type text,
  content text,
  importance float,
  source_ids jsonb,
  created_at timestamptz,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rn.id, rn.note_type, rn.content, rn.importance,
    rn.source_ids, rn.created_at, rn.metadata,
    (1 - (rn.embedding <=> query_embedding))::float AS similarity
  FROM public.reflection_notes rn
  WHERE rn.user_id = filter_user_id
    AND (1 - (rn.embedding <=> query_embedding)) > match_threshold
    AND (filter_note_type IS NULL OR rn.note_type = filter_note_type)
  ORDER BY rn.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
