import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { VoiceButton } from "@/components/VoiceButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const AINameIntake = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setShowConfirmation(true);
    
    setTimeout(async () => {
      setLoading(true);
      await api.onboarding.setAIName(name);
      localStorage.setItem("assistantName", name);
      setLoading(false);
      navigate("/onboarding/location");
    }, 2000);
  };

  const handleVoiceInput = (text: string) => {
    setName(text);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        {!showConfirmation ? (
          <>
            <div className="space-y-4">
              <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
                Now it's your turn.<br />
                What would you like to call me?
              </h1>
              <p className="text-base text-muted-foreground text-center">
                This will be my name when you talk to me.
              </p>
            </div>
            
            <div className="flex flex-col items-center space-y-6">
              <VoiceButton onVoiceInput={handleVoiceInput} />
              <p className="text-sm text-muted-foreground">Tap to speak or type below</p>
              
              <Input
                type="text"
                placeholder="My name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-14 text-lg rounded-2xl border-border"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
              
              <Button
                onClick={handleSubmit}
                disabled={!name.trim() || loading}
                className="w-full h-14 text-lg rounded-2xl mt-4"
                size="lg"
              >
                Continue
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center space-y-8 animate-fade-in">
            <div className="bg-secondary/50 backdrop-blur-sm p-8 rounded-3xl border border-border/50">
              <p className="text-xl text-foreground leading-relaxed">
                Great. I'll answer to "Hey {name}."
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AINameIntake;
