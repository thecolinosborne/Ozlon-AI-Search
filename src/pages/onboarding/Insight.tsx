import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const Insight = () => {
  const navigate = useNavigate();
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(true);
  const connectedApps = localStorage.getItem("connectedApps") || "none";

  useEffect(() => {
    const loadInsight = async () => {
      const result = await api.onboarding.getWowMoment(connectedApps);
      setInsight(result.insight);
      setLoading(false);
    };
    loadInsight();
  }, [connectedApps]);

  const handleContinue = () => {
    navigate("/onboarding/final");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in relative overflow-hidden">
      {/* Soft glow effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse-soft" />
      </div>
      
      <div className="max-w-md w-full space-y-8 relative z-10">
        <div className="space-y-4">
          <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
            Thanks for sharing that with me.
          </h1>
          <p className="text-lg text-muted-foreground text-center">
            Here's something I found that might help you right away.
          </p>
        </div>
        
        {loading ? (
          <div className="bg-secondary/30 backdrop-blur-sm rounded-3xl p-8 animate-pulse border border-border/50">
            <div className="h-20 bg-muted/50 rounded" />
          </div>
        ) : (
          <div className="bg-gradient-to-br from-primary/5 to-primary/10 backdrop-blur-sm rounded-3xl p-8 border border-primary/20 shadow-lg">
            <p className="text-xl text-foreground leading-relaxed text-center">
              {insight}
            </p>
          </div>
        )}
        
        <div className="space-y-3 pt-4">
          <Button
            onClick={handleContinue}
            disabled={loading}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Yes, help with this
          </Button>
          <button
            onClick={handleContinue}
            className="w-full text-muted-foreground text-base hover:text-foreground transition-colors"
          >
            Not right now
          </button>
        </div>
      </div>
    </div>
  );
};

export default Insight;
