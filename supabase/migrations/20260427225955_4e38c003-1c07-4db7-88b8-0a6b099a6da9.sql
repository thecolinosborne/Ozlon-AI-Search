CREATE TABLE IF NOT EXISTS public.entities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'person',
  avatar_url TEXT,
  primary_email TEXT,
  importance_score NUMERIC NOT NULL DEFAULT 0.5,
  relationship_summary TEXT,
  last_interaction_at TIMESTAMP WITH TIME ZONE,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  channel_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] DEFAULT '{}',
  starred BOOLEAN NOT NULL DEFAULT false,
  muted BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entities_user_importance ON public.entities(user_id, importance_score DESC, last_interaction_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_entities_user_name ON public.entities(user_id, display_name);

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own entities" ON public.entities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own entities" ON public.entities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own entities" ON public.entities FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own entities" ON public.entities FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_entities_updated_at BEFORE UPDATE ON public.entities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.entity_identities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  identifier TEXT NOT NULL,
  display_label TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel, identifier)
);

CREATE INDEX IF NOT EXISTS idx_entity_identities_lookup ON public.entity_identities(user_id, channel, identifier);
CREATE INDEX IF NOT EXISTS idx_entity_identities_entity ON public.entity_identities(entity_id);

ALTER TABLE public.entity_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own identities" ON public.entity_identities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own identities" ON public.entity_identities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own identities" ON public.entity_identities FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own identities" ON public.entity_identities FOR DELETE USING (auth.uid() = user_id);