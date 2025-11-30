import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PillButton } from "@/components/PillButton";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const connections = ["Bank", "Email", "Calendar", "Food Delivery"];

const Connections = () => {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!selected) return;
    setLoading(true);
    await api.onboarding.selectConnection(selected);
    setLoading(false);
    navigate("/onboarding/connect-service");
  };

  const handleSkip = () => {
    navigate("/onboarding/insight");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
          To help you better, I can connect to your apps. Which would you like to start with?
        </h1>
        
        <div className="flex flex-wrap gap-3 justify-center">
          {connections.map((connection) => (
            <PillButton
              key={connection}
              onClick={() => setSelected(connection)}
              selected={selected === connection}
            >
              {connection}
            </PillButton>
          ))}
        </div>
        
        <div className="space-y-4">
          <Button
            onClick={handleContinue}
            disabled={!selected || loading}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Continue
          </Button>
          
          <Button
            onClick={handleSkip}
            variant="ghost"
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Connections;
