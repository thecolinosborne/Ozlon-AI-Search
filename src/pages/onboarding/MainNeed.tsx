import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PillButton } from "@/components/PillButton";
import { VoiceButton } from "@/components/VoiceButton";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const needs = ["Money", "Food", "Work", "Stress", "Something else"];

const MainNeed = () => {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!selected) return;
    setLoading(true);
    await api.onboarding.setPrimaryNeed(selected);
    setLoading(false);
    navigate("/onboarding/focus");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
          Everyone has something they're dealing with.<br />
          What's on your mind today?
        </h1>
        
        <div className="flex flex-col items-center space-y-6">
          <VoiceButton />
          
          <div className="flex flex-wrap gap-3 justify-center w-full">
            {needs.map((need) => (
              <PillButton
                key={need}
                onClick={() => setSelected(need)}
                selected={selected === need}
              >
                {need}
              </PillButton>
            ))}
          </div>
          
          <Button
            onClick={handleContinue}
            disabled={!selected || loading}
            className="w-full h-14 text-lg rounded-2xl mt-4"
            size="lg"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MainNeed;
