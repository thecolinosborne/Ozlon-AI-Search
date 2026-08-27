import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Calendar, MapPin, ExternalLink, ArrowLeft, Search, Ticket, CalendarPlus, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

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
  venue_name: string | null;
  address: string | null;
  organizer: string | null;
  registration_url: string | null;
  cost_text: string | null;
  cost_min: number | null;
  cost_max: number | null;
  is_free: boolean | null;
  ticket_notes: string | null;
  calendar_event_id: string | null;
  timezone: string | null;
}

function costLabel(e: DiscoveredEvent) {
  if (e.is_free === true) return "Free";
  if (e.cost_text) return e.cost_text;
  if (e.cost_min != null && e.cost_max != null && e.cost_max !== e.cost_min)
    return `$${e.cost_min}–$${e.cost_max}`;
  if (e.cost_min != null) return e.cost_min === 0 ? "Free" : `$${e.cost_min}`;
  return "Price not listed";
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
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30 px-4 py-3">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button onClick={() => navigate("/")} className="p-2 -ml-2 rounded-xl hover:bg-muted/50">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold">Events</h1>
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
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(!!event.calendar_event_id);
  const cost = costLabel(event);
  const free = event.is_free === true || cost === "Free";
  const where = [event.venue_name, event.address || event.location].filter(Boolean).join(" — ");

  const addToCalendar = async () => {
    setAdding(true);
    try {
      const { data, error } = await supabase.functions.invoke("chat", {
        body: {
          messages: [
            {
              role: "user",
              content: `Add the saved event with id ${event.id} to my Google Calendar using add_events_to_calendar.`,
            },
          ],
          enableTools: true,
        },
      });
      if (error) throw error;
      setAdded(true);
      toast({ title: "Added to calendar", description: event.title });
      void data;
    } catch (e) {
      toast({
        title: "Could not add to calendar",
        description: e instanceof Error ? e.message : "Try again from chat.",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

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
        <div className="flex-1 min-w-0 space-y-1.5">
          <h3 className="font-medium text-foreground">{event.title}</h3>
          {event.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{event.description}</p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(event.event_date)}
            </span>
            {where && (
              <span className="flex items-center gap-1 min-w-0">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{where}</span>
              </span>
            )}
            <span
              className={cn(
                "flex items-center gap-1",
                free ? "text-emerald-500" : "text-foreground/80"
              )}
            >
              <Ticket className="w-3.5 h-3.5" />
              {cost}
            </span>
          </div>
          {event.ticket_notes && (
            <p className="text-xs text-muted-foreground/80">{event.ticket_notes}</p>
          )}
          {event.organizer && (
            <p className="text-xs text-muted-foreground/70">Hosted by {event.organizer}</p>
          )}
        </div>
        {(event.registration_url || event.url) && (
          <a
            href={event.registration_url || event.url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-xl hover:bg-muted/50 text-muted-foreground"
            aria-label="Open event page"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-3">
        {event.category ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
            {event.category}
          </span>
        ) : (
          <span />
        )}
        {!isPast && (
          <button
            onClick={addToCalendar}
            disabled={adding || added}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors",
              added
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-muted/50 text-foreground hover:bg-muted"
            )}
          >
            {adding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : added ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <CalendarPlus className="w-3.5 h-3.5" />
            )}
            {added ? "On calendar" : adding ? "Adding" : "Add to calendar"}
          </button>
        )}
      </div>
    </div>
  );
}
