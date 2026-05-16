export interface Flight {
  id: string;
  airline: string;
  airline_code: string;
  flight_number: string;
  depart_time: string;
  arrive_time: string;
  duration_min: number;
  stops: number;
  origin_code: string;
  dest_code: string;
  price_usd: number;
  baseline_usd: number;
  trend: "falling" | "rising" | "flat";
  delta_pct: number;
  refundable: boolean;
  carry_on_included: boolean;
  deep_link: string;
  sparkline: number[];
}

export interface Stay {
  id: string;
  name: string;
  kind: "hotel" | "airbnb";
  neighborhood: string;
  rating: number;
  reviews: number;
  per_night_usd: number;
  total_usd: number;
  baseline_usd: number;
  trend: "falling" | "rising" | "flat";
  free_cancellation: boolean;
  photos: string[];
  coords: { lat: number; lng: number };
  deep_link: string;
}

export interface TripEvent {
  id: string;
  title: string;
  when: string;
  price_usd: number;
  kind: string;
  photo: string;
  deep_link: string;
}

export interface BestDay {
  date: string;
  label: string;
  price_usd: number;
  tier: "low" | "mid" | "high";
}

export interface TripPlan {
  destination: string;
  origin: string;
  start_date: string;
  end_date: string;
  nights: number;
  travelers: number;
  vibe: string | null;
  total_usd: number;
  baseline_usd: number;
  trend: "falling" | "rising" | "flat";
  flights: Flight[];
  stays: Stay[];
  events: TripEvent[];
  best_days: BestDay[];
  hero_summary: string;
}
