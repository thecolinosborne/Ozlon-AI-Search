-- Phase 3: Formatting Engine telemetry
-- Logs router decisions + verifier results so we can tune mode thresholds
-- from real turns instead of guessing.

CREATE TABLE public.formatting_telemetry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  session_id TEXT,
  -- Router decision (always present)
  mode TEXT NOT NULL,                  -- ATOMIC | CHAT | BRIEF | EXECUTION | DOCUMENT | LONGFORM
  router_reason TEXT,                  -- short tag from routeFormat
  path TEXT NOT NULL DEFAULT 'stream', -- stream | tools
  user_text_len INT,
  output_chars INT,
  -- Verifier result (nullable — only when verifier ran)
  verifier_op_mode TEXT,               -- off | shadow | active
  verifier_ok BOOLEAN,
  verifier_issues JSONB,
  verifier_latency_ms INT,
  verifier_model TEXT,
  verifier_skipped TEXT,
  verifier_repaired BOOLEAN,
  -- Optional longform context
  longform_kind TEXT,
  longform_target_words INT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.formatting_telemetry ENABLE ROW LEVEL SECURITY;

-- Users can read their own telemetry rows. Writes are server-side only
-- (edge function uses service role) so no INSERT policy is exposed.
CREATE POLICY "Users can view their own formatting telemetry"
  ON public.formatting_telemetry
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_formatting_telemetry_created_at
  ON public.formatting_telemetry (created_at DESC);
CREATE INDEX idx_formatting_telemetry_mode_created
  ON public.formatting_telemetry (mode, created_at DESC);
CREATE INDEX idx_formatting_telemetry_user_created
  ON public.formatting_telemetry (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;