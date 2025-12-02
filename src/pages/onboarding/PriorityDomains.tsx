import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const PriorityDomains = () => {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInsight, setShowInsight] = useState(false);

  const handleContinue = async () => {
    setLoading(true);
    await api.onboarding.setPriorityDomains(selected);
    localStorage.setItem("priorityDomains", JSON.stringify(selected));
    setLoading(false);
    setShowInsight(true);
  };

  const handleNextStep = () => {
    navigate("/onboarding/existing-systems");
  };

  const toggleDomain = (id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const domains = [
    "Time",
    "Money",
    "Health",
    "Work",
    "Home",
    "Learning",
    "None at this time",
  ];

  if (showInsight) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
        <div className="max-w-md w-full space-y-8 text-center">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Domains Indexed
          </h1>
          <div className="bg-secondary/50 backdrop-blur-sm p-8 rounded-3xl border border-border/50">
            <p className="text-lg text-muted-foreground leading-relaxed">
              The Orb will surface insights and opportunities related to the domains you selected. These categories will influence the Orb's initial model.
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
            Step 2 of 4: Priority Domains
          </h1>
          <p className="text-base text-muted-foreground">
            Select the domains you want the Orb to prioritize.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {domains.map((domain) => (
            <button
              key={domain}
              onClick={() => toggleDomain(domain)}
              className={`h-16 rounded-2xl border transition-all ${
                selected.includes(domain)
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/50"
              } ${domain === "None at this time" ? "col-span-2" : ""}`}
            >
              <span className="text-base">{domain}</span>
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

export default PriorityDomains;
