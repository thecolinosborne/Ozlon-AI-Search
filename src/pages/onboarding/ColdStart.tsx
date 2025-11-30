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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in relative overflow-hidden">
      {/* Soft floating glow animation */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse-soft" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: "1s" }} />
      </div>
      
      <div className="max-w-md w-full space-y-8 text-center relative z-10">
        <h1 className="text-3xl font-medium text-foreground leading-relaxed">
          Hi, I'm your personal assistant.<br />
          Before we begin, I want to get to know you.
        </h1>
        
        <div className="pt-8">
          <Button
            onClick={handleStart}
            disabled={loading}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Okay
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ColdStart;
