import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { VoiceButton } from "@/components/VoiceButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const NameIntake = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await api.onboarding.setName(name);
    localStorage.setItem("userName", name);
    setLoading(false);
    navigate("/onboarding/location");
  };

  const handleVoiceInput = (text: string) => {
    setName(text);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center">
          What's your name?
        </h1>
        
        <div className="flex flex-col items-center space-y-6">
          <VoiceButton onVoiceInput={handleVoiceInput} />
          <p className="text-sm text-muted-foreground">Tap to speak or type below</p>
          
          <Input
            type="text"
            placeholder="Your name"
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
      </div>
    </div>
  );
};

export default NameIntake;
