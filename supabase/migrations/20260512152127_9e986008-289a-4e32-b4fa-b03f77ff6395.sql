
-- Phase 1: Ozlon Research — persistent reports with personal-context fusion

CREATE TABLE public.research_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  query text NOT NULL,
  answer text NOT NULL,
  mode text NOT NULL DEFAULT 'personal' CHECK (mode IN ('fast','deep','personal')),
  confidence numeric(3,2) DEFAULT 0.7,
  follow_ups jsonb NOT NULL DEFAULT '[]'::jsonb,
  personal_context jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_living_thread boolean NOT NULL DEFAULT false,
  last_refreshed_at timestamptz,
  embedding extensions.vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_research_reports_user ON public.research_reports(user_id, created_at DESC);
CREATE INDEX idx_research_reports_conversation ON public.research_reports(conversation_id);
CREATE INDEX idx_research_reports_living ON public.research_reports(user_id, is_living_thread) WHERE is_living_thread = true;

ALTER TABLE public.research_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own research reports"
  ON public.research_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own research reports"
  ON public.research_reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own research reports"
  ON public.research_reports FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access research reports"
  ON public.research_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_research_reports_updated
  BEFORE UPDATE ON public.research_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Sources for each report (web links, gmail refs, calendar refs, wisdom refs)
CREATE TABLE public.research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.research_reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('web','gmail','calendar','wisdom','knowledge')),
  url text,
  title text,
  snippet text,
  citation_index integer,
  relevance_score numeric(3,2),
  reference_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_research_sources_report ON public.research_sources(report_id);
CREATE INDEX idx_research_sources_user ON public.research_sources(user_id);

ALTER TABLE public.research_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own research sources"
  ON public.research_sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access research sources"
  ON public.research_sources FOR ALL TO service_role USING (true) WITH CHECK (true);
