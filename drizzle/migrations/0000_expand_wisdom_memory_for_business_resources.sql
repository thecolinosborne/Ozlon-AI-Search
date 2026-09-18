-- Add source/tracking columns to wisdom_memories for business-resource memory
ALTER TABLE public.wisdom_memories 
  ADD COLUMN IF NOT EXISTS source_tool text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS session_id uuid;

CREATE INDEX IF NOT EXISTS idx_wisdom_memories_resource ON public.wisdom_memories(user_id, resource_type, external_id);
CREATE INDEX IF NOT EXISTS idx_wisdom_memories_source_tool ON public.wisdom_memories(user_id, source_tool);
CREATE INDEX IF NOT EXISTS idx_wisdom_memories_session ON public.wisdom_memories(user_id, session_id);

-- Memory links relate one memory to another (e.g. email -> task -> event)
CREATE TABLE public.memory_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_memory_id uuid NOT NULL REFERENCES public.wisdom_memories(id) ON DELETE CASCADE,
  target_memory_id uuid NOT NULL REFERENCES public.wisdom_memories(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'related_to',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_links_relationship_check CHECK (relationship IN (
    'created_from', 'related_to', 'follow_up_to', 'mentions', 'derived_from'
  ))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_links TO authenticated;
GRANT ALL ON public.memory_links TO service_role;

ALTER TABLE public.memory_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own memory links"
  ON public.memory_links FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memory links"
  ON public.memory_links FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own memory links"
  ON public.memory_links FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_memory_links_user ON public.memory_links(user_id);
CREATE INDEX idx_memory_links_source ON public.memory_links(source_memory_id);
CREATE INDEX idx_memory_links_target ON public.memory_links(target_memory_id);
