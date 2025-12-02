import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const DailyStructure = () => {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [showInsight, setShowInsight] = useState(false);

  const handleContinue = async () => {
    if (!selected) return;
    setLoading(true);
    await api.onboarding.setDailyStructure(selected);
    localStorage.setItem("dailyStructure", selected);
    setLoading(false);
    setShowInsight(true);
  };

  const handleNextStep = () => {
    navigate("/onboarding/priority-domains");
  };

  const structures = [
    { 
      id: "consistent", 
      label: "Consistent",
      insight: "The Orb will prepare time-based recommendations aligned with predictable cycles."
    },
    { 
      id: "variable", 
      label: "Variable",
      insight: "The Orb will align itself with your active periods instead of fixed times."
    },
    { 
      id: "mixed", 
      label: "Mixed",
      insight: "The Orb will detect patterns as they emerge and adjust its model accordingly."
    },
  ];

  const selectedStructure = structures.find(s => s.id === selected);

  if (showInsight) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
        <div className="max-w-md w-full space-y-8 text-center">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Observation Logged
          </h1>
          <div className="bg-secondary/50 backdrop-blur-sm p-8 rounded-3xl border border-border/50">
            <p className="text-lg text-muted-foreground leading-relaxed">
              {selectedStructure?.insight}
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
            Step 1 of 4: Daily Structure
          </h1>
          <p className="text-base text-muted-foreground">
            How would you describe the general structure of your days?
          </p>
        </div>

        <div className="space-y-3">
          {structures.map((structure) => (
            <button
              key={structure.id}
              onClick={() => setSelected(structure.id)}
              className={`w-full h-20 rounded-2xl border transition-all ${
                selected === structure.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/50"
              }`}
            >
              <span className="text-xl">{structure.label}</span>
            </button>
          ))}
        </div>

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

export default DailyStructure;
