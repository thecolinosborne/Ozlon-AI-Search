import { useNavigate } from "react-router-dom";
import { DollarSign, Calendar, MapPin, Sparkles, Brain, TrendingUp } from "lucide-react";
import { DashboardCard } from "@/components/home/DashboardCard";
import { useAppStore } from "@/stores/useAppStore";
import { AIOrb } from "@/components/AIOrb";

const Home = () => {
  const navigate = useNavigate();
  const { user } = useAppStore();
  const orbName = user?.orbName || "Orb";

  const handleCardClick = (action: string) => {
    navigate("/chat", { state: { intent: action } });
  };

  const cards = [
    {
      id: "money",
      title: "Money analysis",
      description: "Review spending patterns and financial opportunities",
      icon: DollarSign,
      action: "money_analysis",
      variant: "primary" as const,
    },
    {
      id: "due",
      title: "Due items",
      description: "Check upcoming deadlines and scheduled tasks",
      icon: Calendar,
      action: "due_items",
      variant: "default" as const,
    },
    {
      id: "location",
      title: "Location resources",
      description: "Find nearby services and civic resources",
      icon: MapPin,
      action: "location_resources",
      variant: "default" as const,
    },
    {
      id: "summary",
      title: "Daily summary",
      description: "Get an overview of your day and priorities",
      icon: Sparkles,
      action: "daily_summary",
      variant: "default" as const,
    },
    {
      id: "patterns",
      title: "Pattern analysis",
      description: "Discover trends and behavioral insights",
      icon: Brain,
      action: "pattern_analysis",
      variant: "muted" as const,
    },
    {
      id: "opportunities",
      title: "Opportunity detection",
      description: "Identify actionable opportunities across domains",
      icon: TrendingUp,
      action: "opportunities",
      variant: "muted" as const,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 pb-24">
      {/* Header */}
      <header className="px-6 pt-12 pb-8 safe-area-top">
        <div className="flex items-center gap-4 mb-2">
          <AIOrb breatheIn={true} />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{orbName}</h1>
            <p className="text-sm text-muted-foreground">Active and observing</p>
          </div>
        </div>
      </header>

      {/* Dashboard Grid */}
      <div className="px-4">
        <div className="grid gap-3">
          {cards.map((card) => (
            <DashboardCard
              key={card.id}
              title={card.title}
              description={card.description}
              icon={card.icon}
              onClick={() => handleCardClick(card.action)}
              variant={card.variant}
            />
          ))}
        </div>

        {/* Future Cards Placeholder */}
        <div className="mt-6 p-4 rounded-2xl border border-dashed border-border/40 bg-muted/20">
          <p className="text-sm text-muted-foreground text-center">
            Additional modules will appear here as agents come online
          </p>
        </div>
      </div>
    </div>
  );
};

export default Home;
