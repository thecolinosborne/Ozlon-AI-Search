ALTER TABLE public.standing_orders
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.standing_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

ALTER TABLE public.wisdom_memories
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.wisdom_memories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_standing_orders_user_active
  ON public.standing_orders (user_id, active);

CREATE INDEX IF NOT EXISTS idx_wisdom_memories_user_type
  ON public.wisdom_memories (user_id, memory_type);