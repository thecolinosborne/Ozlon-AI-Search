
-- Trips: a high-level trip request
CREATE TABLE public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  destination TEXT,
  origin TEXT,
  budget_usd NUMERIC,
  start_date DATE,
  end_date DATE,
  trip_length_nights INT,
  travelers INT DEFAULT 1,
  vibe TEXT,
  lodging_pref TEXT,
  avoid_car BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.trip_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  raw_query TEXT NOT NULL,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.trip_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  destination TEXT,
  origin TEXT,
  start_date DATE,
  end_date DATE,
  total_usd NUMERIC,
  baseline_usd NUMERIC,
  trend TEXT,
  flights JSONB DEFAULT '[]'::jsonb,
  stays JSONB DEFAULT '[]'::jsonb,
  events JSONB DEFAULT '[]'::jsonb,
  best_days JSONB DEFAULT '[]'::jsonb,
  hero_summary TEXT,
  streaming_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.trip_budget_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_option_id UUID REFERENCES public.trip_options(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  label TEXT,
  amount_usd NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.saved_trip_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_option_id UUID REFERENCES public.trip_options(id) ON DELETE CASCADE,
  nickname TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.travel_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  preferred_airlines TEXT[] DEFAULT '{}',
  blocked_airlines TEXT[] DEFAULT '{}',
  preferred_hotel_chains TEXT[] DEFAULT '{}',
  blocked_hotel_chains TEXT[] DEFAULT '{}',
  lodging_pref TEXT DEFAULT 'either',
  avoid_car BOOLEAN DEFAULT FALSE,
  home_airport TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.trip_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_option_id UUID REFERENCES public.trip_options(id) ON DELETE CASCADE,
  target_total_usd NUMERIC,
  max_total_usd NUMERIC,
  last_total_usd NUMERIC,
  last_checked_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trips_user_idx ON public.trips(user_id, created_at DESC);
CREATE INDEX trip_searches_user_idx ON public.trip_searches(user_id, created_at DESC);
CREATE INDEX trip_options_user_idx ON public.trip_options(user_id, created_at DESC);
CREATE INDEX trip_options_trip_idx ON public.trip_options(trip_id);
CREATE INDEX trip_budget_items_option_idx ON public.trip_budget_items(trip_option_id);
CREATE INDEX saved_trip_plans_user_idx ON public.saved_trip_plans(user_id, created_at DESC);
CREATE INDEX trip_watchlist_user_idx ON public.trip_watchlist(user_id) WHERE active;

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_trip_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_watchlist ENABLE ROW LEVEL SECURITY;

-- Owner-only policies
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['trips','trip_searches','trip_options','trip_budget_items','saved_trip_plans','travel_preferences','trip_watchlist']) LOOP
    EXECUTE format('CREATE POLICY "owner_select_%I" ON public.%I FOR SELECT USING (auth.uid() = user_id)', t, t);
    EXECUTE format('CREATE POLICY "owner_insert_%I" ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id)', t, t);
    EXECUTE format('CREATE POLICY "owner_update_%I" ON public.%I FOR UPDATE USING (auth.uid() = user_id)', t, t);
    EXECUTE format('CREATE POLICY "owner_delete_%I" ON public.%I FOR DELETE USING (auth.uid() = user_id)', t, t);
  END LOOP;
END$$;

CREATE TRIGGER trips_updated_at BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trip_options_updated_at BEFORE UPDATE ON public.trip_options
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER travel_preferences_updated_at BEFORE UPDATE ON public.travel_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
