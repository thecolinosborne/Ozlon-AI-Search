import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const CommunicationMode = () => {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!selected) return;
    setLoading(true);
    await api.onboarding.setCommunicationMode(selected);
    localStorage.setItem("communicationMode", selected);
    setLoading(false);
    navigate("/onboarding/orb-orientation");
  };

  const modes = [
    { id: "type", label: "Type" },
    { id: "voice", label: "Voice" },
    { id: "both", label: "Both" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Communication Mode
          </h1>
          <p className="text-base text-muted-foreground">
            Select how you prefer to interact with the Orb.
          </p>
        </div>

        <div className="space-y-3">
          {modes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setSelected(mode.id)}
              className={`w-full h-16 rounded-2xl border transition-all ${
                selected === mode.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/50"
              }`}
            >
              <span className="text-lg">{mode.label}</span>
            </button>
          ))}
        </div>

        <p className="text-sm text-muted-foreground text-center">
          You may change this later.
        </p>

        <Button
          onClick={handleContinue}
          disabled={!selected || loading}
          className="w-full h-14 text-lg rounded-2xl"
          size="lg"
        >
          Continue
        </Button>
      </div>
    </div>
  );
};

export default CommunicationMode;
