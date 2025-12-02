import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const ExistingSystems = () => {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInsight, setShowInsight] = useState(false);

  const handleContinue = async () => {
    setLoading(true);
    await api.onboarding.setExistingSystems(selected);
    localStorage.setItem("existingSystems", JSON.stringify(selected));
    setLoading(false);
    setShowInsight(true);
  };

  const handleNextStep = () => {
    navigate("/onboarding/insight-style");
  };

  const toggleSystem = (id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const systems = [
    "Google Calendar",
    "Apple Calendar",
    "Email",
    "Notes",
    "Banking apps",
    "To-do apps",
    "Not certain",
  ];

  if (showInsight) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
        <div className="max-w-md w-full space-y-8 text-center">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Systems Detected
          </h1>
          <div className="bg-secondary/50 backdrop-blur-sm p-8 rounded-3xl border border-border/50">
            <p className="text-lg text-muted-foreground leading-relaxed">
              The Orb will match potential integrations and automations with your selected systems. All connections are optional.
            </p>
          </div>

          <Button
            onClick={handleNextStep}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Next Step
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Step 3 of 4: Existing Systems
          </h1>
          <p className="text-base text-muted-foreground">
            Which systems do you currently rely on?
          </p>
        </div>

        <div className="space-y-2">
          {systems.map((system) => (
            <button
              key={system}
              onClick={() => toggleSystem(system)}
              className={`w-full h-14 rounded-2xl border transition-all ${
                selected.includes(system)
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/50"
              }`}
            >
              <span className="text-base">{system}</span>
            </button>
          ))}
        </div>

        <Button
          onClick={handleContinue}
          disabled={selected.length === 0 || loading}
          className="w-full h-14 text-lg rounded-2xl"
          size="lg"
        >
          Continue
        </Button>
      </div>
    </div>
  );
};

export default ExistingSystems;
