import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const Insight = () => {
  const navigate = useNavigate();
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadInsight = async () => {
      const response = await api.onboarding.getInsight();
      setInsight(response.insight);
      setLoading(false);
    };
    loadInsight();
  }, []);

  const handleContinue = () => {
    navigate("/onboarding/final");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
          Here's something useful I found for you.
        </h1>

        {loading ? (
          <div className="bg-secondary p-8 rounded-3xl flex items-center justify-center min-h-[120px]">
            <div className="flex space-x-2">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse-soft" />
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse-soft" style={{ animationDelay: "0.2s" }} />
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse-soft" style={{ animationDelay: "0.4s" }} />
            </div>
          </div>
        ) : (
          <div className="bg-secondary p-8 rounded-3xl animate-scale-in">
            <p className="text-lg text-foreground text-center leading-relaxed">
              {insight}
            </p>
          </div>
        )}

        <div className="space-y-3">
          <Button
            onClick={handleContinue}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Tell me more
          </Button>
          <Button
            onClick={handleContinue}
            variant="ghost"
            className="w-full h-14 text-lg rounded-2xl text-muted-foreground"
            size="lg"
          >
            Not right now
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Insight;
