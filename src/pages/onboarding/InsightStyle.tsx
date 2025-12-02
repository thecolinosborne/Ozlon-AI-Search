import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const InsightStyle = () => {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [showInsight, setShowInsight] = useState(false);

  const handleContinue = async () => {
    if (!selected) return;
    setLoading(true);
    await api.onboarding.setInsightStyle(selected);
    localStorage.setItem("insightStyle", selected);
    setLoading(false);
    setShowInsight(true);
  };

  const handleFinish = () => {
    navigate("/onboarding/optional-connections");
  };

  const styles = [
    { id: "direct", label: "Direct" },
    { id: "detailed", label: "Detailed" },
    { id: "visual", label: "Visual" },
    { id: "adaptive", label: "Adaptive" },
  ];

  if (showInsight) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
        <div className="max-w-md w-full space-y-8 text-center">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Preference Stored
          </h1>
          <div className="bg-secondary/50 backdrop-blur-sm p-8 rounded-3xl border border-border/50">
            <p className="text-lg text-muted-foreground leading-relaxed">
              The Orb will align its communication format with your selection.
            </p>
          </div>

          <Button
            onClick={handleFinish}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Finish Setup
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
            Step 4 of 4: Insight Format
          </h1>
          <p className="text-base text-muted-foreground">
            How should the Orb present information?
          </p>
        </div>

        <div className="space-y-3">
          {styles.map((style) => (
            <button
              key={style.id}
              onClick={() => setSelected(style.id)}
              className={`w-full h-16 rounded-2xl border transition-all ${
                selected === style.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/50"
              }`}
            >
              <span className="text-lg">{style.label}</span>
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

export default InsightStyle;
