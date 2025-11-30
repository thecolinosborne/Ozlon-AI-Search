import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { useState } from "react";

const ColdStart = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    await api.onboarding.start();
    setLoading(false);
    navigate("/onboarding/name");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8 text-center">
        <h1 className="text-3xl font-medium text-foreground leading-relaxed">
          Hi, I'm Ozlon. Let's make your life easier. Can I learn a little about you?
        </h1>
        
        <div className="space-y-4 pt-8">
          <Button
            onClick={handleStart}
            disabled={loading}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Yes
          </Button>
          
          <Button
            onClick={() => navigate("/chat")}
            variant="ghost"
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ColdStart;
