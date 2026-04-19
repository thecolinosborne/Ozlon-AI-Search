import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Calendar, MapPin, ExternalLink, ArrowLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { TopNav } from "@/components/navigation/TopNav";

interface DiscoveredEvent {
  id: string;
  title: string;
  description: string | null;
  event_date: string | null;
  end_date: string | null;
  location: string | null;
  url: string | null;
  source: string | null;
  category: string | null;
  created_at: string;
}

const CATEGORIES = ["all", "networking", "conference", "meetup", "workshop", "webinar", "other"];

export default function Events() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<DiscoveredEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    if (!user) return;
    const fetchEvents = async () => {
      setLoading(true);
      let query = supabase
        .from("discovered_events" as any)
        .select("*")
        .order("event_date", { ascending: true });

      if (activeCategory !== "all") {
        query = query.eq("category", activeCategory);
      }

      const { data } = await query;
      setEvents((data as unknown as DiscoveredEvent[]) || []);
      setLoading(false);
    };
    fetchEvents();
  }, [user, activeCategory]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Date TBD";
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const upcomingEvents = events.filter(
    (e) => !e.event_date || new Date(e.event_date) >= new Date()
  );
  const pastEvents = events.filter(
    (e) => e.event_date && new Date(e.event_date) < new Date()
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30 px-4 py-3">
        <div className="flex items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="p-2 -ml-2 rounded-xl hover:bg-muted/50">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold">Events</h1>
          </div>
          <TopNav />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                activeCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        {/* Empty state */}
        {!loading && events.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <Search className="w-12 h-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground">No events found yet</p>
            <p className="text-sm text-muted-foreground/70">
              Ask the AI to find events — e.g. "Find networking events in LA for June 2026"
            </p>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted/30 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Upcoming */}
        {upcomingEvents.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground px-1">Upcoming</h2>
            {upcomingEvents.map((evt) => (
              <EventCard key={evt.id} event={evt} formatDate={formatDate} />
            ))}
          </div>
        )}

        {/* Past */}
        {pastEvents.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground px-1">Past</h2>
            {pastEvents.map((evt) => (
              <EventCard key={evt.id} event={evt} formatDate={formatDate} isPast />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventCard({
  event,
  formatDate,
  isPast,
}: {
  event: DiscoveredEvent;
  formatDate: (d: string | null) => string;
  isPast?: boolean;
}) {
  return (
    <div
      className={cn(
        "p-4 rounded-2xl border backdrop-blur-md transition-all",
        isPast
          ? "bg-muted/20 border-border/20 opacity-60"
          : "bg-card/60 border-border/40 hover:bg-card/80"
      )}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <h3 className="font-medium text-foreground truncate">{event.title}</h3>
          {event.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{event.description}</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(event.event_date)}
            </span>
            {event.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {event.location}
              </span>
            )}
          </div>
        </div>
        {event.url && (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-xl hover:bg-muted/50 text-muted-foreground"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
      {event.category && (
        <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
          {event.category}
        </span>
      )}
    </div>
  );
}
