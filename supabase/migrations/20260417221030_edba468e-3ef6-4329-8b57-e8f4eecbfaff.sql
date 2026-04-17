-- Standing Orders: durable rules the worker always obeys
CREATE TABLE public.standing_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  rule TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  priority INT NOT NULL DEFAULT 5,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.standing_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own standing orders" ON public.standing_orders
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own standing orders" ON public.standing_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own standing orders" ON public.standing_orders
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own standing orders" ON public.standing_orders
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_standing_orders_user_active ON public.standing_orders(user_id, active);

CREATE TRIGGER update_standing_orders_updated_at
  BEFORE UPDATE ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- User Goals
CREATE TABLE public.user_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  target_date DATE,
  progress_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own goals" ON public.user_goals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own goals" ON public.user_goals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own goals" ON public.user_goals
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own goals" ON public.user_goals
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_user_goals_user_status ON public.user_goals(user_id, status);

CREATE TRIGGER update_user_goals_updated_at
  BEFORE UPDATE ON public.user_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Model call telemetry
CREATE TABLE public.model_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID,
  model TEXT NOT NULL,
  lane TEXT,
  latency_ms INT,
  tokens_in INT,
  tokens_out INT,
  est_cost NUMERIC(10,6),
  tool_used TEXT,
  user_reaction TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.model_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own model calls" ON public.model_calls
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own model calls" ON public.model_calls
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own model calls" ON public.model_calls
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on model_calls" ON public.model_calls
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_model_calls_user_created ON public.model_calls(user_id, created_at DESC);

-- Conversation rolling summary
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS summary TEXT;