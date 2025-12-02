import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceButton } from "@/components/VoiceButton";
import { AIOrb } from "@/components/AIOrb";

const OrbNaming = () => {
  const navigate = useNavigate();
  const [orbName, setOrbName] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleContinue = () => {
    if (!orbName.trim()) return;
    
    localStorage.setItem("orbName", orbName.trim());
    setShowConfirmation(true);
    
    setTimeout(() => {
      navigate("/onboarding/communication-mode");
    }, 2000);
  };

  const handleVoiceInput = (text: string) => {
    setOrbName(text);
  };

  if (showConfirmation) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
        <div className="scale-[1.5] mb-8">
          <AIOrb breatheIn={true} />
        </div>
        <div className="max-w-md w-full text-center space-y-6">
          <p className="text-lg text-foreground leading-relaxed">
            Understood. I will respond to {orbName}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="scale-[1.5] mb-12">
        <AIOrb breatheIn={true} />
      </div>

      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-4">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Name Assignment
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            What should this system be called?
          </p>
        </div>

        <div className="space-y-6">
          <div className="relative">
            <Input
              type="text"
              placeholder="Enter name"
              value={orbName}
              onChange={(e) => setOrbName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleContinue()}
              className="w-full h-14 text-center text-lg rounded-2xl bg-background/70 backdrop-blur-sm border-border/40"
            />
          </div>

          <div className="flex flex-col items-center gap-2">
            <VoiceButton onVoiceInput={handleVoiceInput} />
            <span className="text-sm text-muted-foreground/60">Or speak the name</span>
          </div>
        </div>

        <Button
          onClick={handleContinue}
          disabled={!orbName.trim()}
          className="w-full h-14 text-lg rounded-2xl"
          size="lg"
        >
          Continue
        </Button>
      </div>
    </div>
  );
};

export default OrbNaming;
