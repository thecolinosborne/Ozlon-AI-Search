ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS default_ghl_location_id TEXT;
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS active_ghl_location_id TEXT;