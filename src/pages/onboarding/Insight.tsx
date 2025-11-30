import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
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

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center">
          Here's something helpful I found for you:
        </h1>
        
        <div className="bg-secondary rounded-3xl p-8 space-y-4 animate-scale-in">
          <Sparkles className="w-8 h-8 text-primary" />
          {loading ? (
            <div className="h-20 flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
          ) : (
            <p className="text-xl text-foreground leading-relaxed">{insight}</p>
          )}
        </div>
        
        <Button
          onClick={() => navigate("/onboarding/categories")}
          disabled={loading}
          className="w-full h-14 text-lg rounded-2xl"
          size="lg"
        >
          Continue
        </Button>
      </div>
    </div>
  );
};

export default Insight;
