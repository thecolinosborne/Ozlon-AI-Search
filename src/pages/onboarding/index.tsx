import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { Button } from "@/components/ui/button";
import { AIOrb } from "@/components/AIOrb";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

type Step = 
  | "welcome"
  | "name"
  | "orbName"
  | "communication"
  | "dailyStructure"
  | "priorityDomains"
  | "existingSystems"
  | "insightStyle"
  | "complete";

const steps: Step[] = [
  "welcome",
  "name",
  "orbName",
  "communication",
  "dailyStructure",
  "priorityDomains",
  "existingSystems",
  "insightStyle",
  "complete",
];

const Onboarding = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAppStore();
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [name, setName] = useState(user?.name || "");
  const [orbName, setOrbName] = useState(user?.orbName || "");
  const [communicationMode, setCommunicationMode] = useState<"text" | "voice" | "both">(user?.communicationMode || "both");
  const [dailyStructure, setDailyStructure] = useState<"consistent" | "variable" | "mixed">(user?.dailyStructure || "mixed");
  const [priorityDomains, setPriorityDomains] = useState<string[]>(user?.priorityDomains || []);
  const [existingSystems, setExistingSystems] = useState<string[]>(user?.existingSystems || []);
  const [insightStyle, setInsightStyle] = useState<"direct" | "detailed" | "visual" | "adaptive">(user?.insightStyle || "adaptive");

  const stepIndex = steps.indexOf(currentStep);
  const progress = ((stepIndex) / (steps.length - 1)) * 100;

  const nextStep = () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const handleComplete = () => {
    updateUser({
      name,
      orbName: orbName || "Orb",
      communicationMode,
      dailyStructure,
      priorityDomains,
      existingSystems,
      insightStyle,
      onboardingComplete: true,
    });
    navigate("/chat");
  };

  const toggleDomain = (domain: string) => {
    setPriorityDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const toggleSystem = (system: string) => {
    setExistingSystems((prev) =>
      prev.includes(system) ? prev.filter((s) => s !== system) : [...prev, system]
    );
  };

  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <div className="text-center">
            <div className="flex justify-center mb-8">
              <div className="scale-150">
                <AIOrb breatheIn={true} />
              </div>
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-4">Welcome to the Orb</h1>
            <p className="text-muted-foreground leading-relaxed mb-8">
              This system observes, adapts, and aligns itself with how you operate. Your Orb learns from your inputs to generate structure, insights, and efficiencies.
            </p>
            <Button onClick={nextStep} className="w-full h-14 rounded-2xl text-base">
              Begin Setup
            </Button>
          </div>
        );

      case "name":
        return (
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Identification Required</h1>
            <p className="text-muted-foreground mb-8">What should the Orb call you?</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name"
              className="w-full h-14 px-5 rounded-2xl bg-card/60 border border-border/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all mb-8"
            />
            <Button onClick={nextStep} disabled={!name.trim()} className="w-full h-14 rounded-2xl text-base">
              Continue
            </Button>
          </div>
        );

      case "orbName":
        return (
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Name Your System</h1>
            <p className="text-muted-foreground mb-8">What would you like to call the Orb?</p>
            <input
              type="text"
              value={orbName}
              onChange={(e) => setOrbName(e.target.value)}
              placeholder="Enter a name"
              className="w-full h-14 px-5 rounded-2xl bg-card/60 border border-border/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all mb-8"
            />
            <Button onClick={nextStep} className="w-full h-14 rounded-2xl text-base">
              Continue
            </Button>
          </div>
        );

      case "communication":
        return (
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Communication Mode</h1>
            <p className="text-muted-foreground mb-8">Select how you prefer to interact with the Orb.</p>
            <div className="space-y-3 mb-8">
              {(["text", "voice", "both"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setCommunicationMode(mode)}
                  className={cn(
                    "w-full p-4 rounded-2xl text-left transition-all duration-200 border",
                    communicationMode === mode
                      ? "bg-primary/10 border-primary/50"
                      : "bg-card/60 border-border/40 hover:bg-card/80"
                  )}
                >
                  <span className="font-medium capitalize">{mode === "both" ? "Text and Voice" : mode}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center mb-4">You may change this later.</p>
            <Button onClick={nextStep} className="w-full h-14 rounded-2xl text-base">
              Continue
            </Button>
          </div>
        );

      case "dailyStructure":
        return (
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Daily Structure</h1>
            <p className="text-muted-foreground mb-8">How would you describe the general structure of your days?</p>
            <div className="space-y-3 mb-8">
              {(["consistent", "variable", "mixed"] as const).map((structure) => (
                <button
                  key={structure}
                  onClick={() => setDailyStructure(structure)}
                  className={cn(
                    "w-full p-4 rounded-2xl text-left transition-all duration-200 border",
                    dailyStructure === structure
                      ? "bg-primary/10 border-primary/50"
                      : "bg-card/60 border-border/40 hover:bg-card/80"
                  )}
                >
                  <span className="font-medium capitalize">{structure}</span>
                </button>
              ))}
            </div>
            <Button onClick={nextStep} className="w-full h-14 rounded-2xl text-base">
              Continue
            </Button>
          </div>
        );

      case "priorityDomains":
        return (
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Priority Domains</h1>
            <p className="text-muted-foreground mb-8">Select the domains you want the Orb to prioritize.</p>
            <div className="grid grid-cols-2 gap-3 mb-8">
              {["Time", "Money", "Health", "Work", "Home", "Learning"].map((domain) => (
                <button
                  key={domain}
                  onClick={() => toggleDomain(domain.toLowerCase())}
                  className={cn(
                    "p-4 rounded-2xl text-center transition-all duration-200 border relative",
                    priorityDomains.includes(domain.toLowerCase())
                      ? "bg-primary/10 border-primary/50"
                      : "bg-card/60 border-border/40 hover:bg-card/80"
                  )}
                >
                  {priorityDomains.includes(domain.toLowerCase()) && (
                    <Check className="absolute top-2 right-2 w-4 h-4 text-primary" />
                  )}
                  <span className="font-medium">{domain}</span>
                </button>
              ))}
            </div>
            <Button onClick={nextStep} className="w-full h-14 rounded-2xl text-base">
              Continue
            </Button>
          </div>
        );

      case "existingSystems":
        return (
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Existing Systems</h1>
            <p className="text-muted-foreground mb-8">Which systems do you currently rely on?</p>
            <div className="space-y-3 mb-8">
              {["Google Calendar", "Apple Calendar", "Email", "Notes", "Banking apps", "To-do apps"].map((system) => (
                <button
                  key={system}
                  onClick={() => toggleSystem(system.toLowerCase())}
                  className={cn(
                    "w-full p-4 rounded-2xl text-left transition-all duration-200 border flex items-center justify-between",
                    existingSystems.includes(system.toLowerCase())
                      ? "bg-primary/10 border-primary/50"
                      : "bg-card/60 border-border/40 hover:bg-card/80"
                  )}
                >
                  <span className="font-medium">{system}</span>
                  {existingSystems.includes(system.toLowerCase()) && (
                    <Check className="w-5 h-5 text-primary" />
                  )}
                </button>
              ))}
            </div>
            <Button onClick={nextStep} className="w-full h-14 rounded-2xl text-base">
              Continue
            </Button>
          </div>
        );

      case "insightStyle":
        return (
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Insight Format</h1>
            <p className="text-muted-foreground mb-8">How should the Orb present information?</p>
            <div className="space-y-3 mb-8">
              {(["direct", "detailed", "visual", "adaptive"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => setInsightStyle(style)}
                  className={cn(
                    "w-full p-4 rounded-2xl text-left transition-all duration-200 border",
                    insightStyle === style
                      ? "bg-primary/10 border-primary/50"
                      : "bg-card/60 border-border/40 hover:bg-card/80"
                  )}
                >
                  <span className="font-medium capitalize">{style}</span>
                </button>
              ))}
            </div>
            <Button onClick={nextStep} className="w-full h-14 rounded-2xl text-base">
              Finish Setup
            </Button>
          </div>
        );

      case "complete":
        return (
          <div className="text-center">
            <div className="flex justify-center mb-8">
              <div className="scale-150">
                <AIOrb breatheIn={true} />
              </div>
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-4">Initial Analysis Complete</h1>
            <div className="text-left space-y-2 mb-8 text-muted-foreground">
              <p className="animate-fade-in" style={{ animationDelay: "0ms" }}>Your daily model has been established.</p>
              <p className="animate-fade-in" style={{ animationDelay: "200ms" }}>Your priority domains have been indexed.</p>
              <p className="animate-fade-in" style={{ animationDelay: "400ms" }}>Your communication style has been configured.</p>
              <p className="animate-fade-in" style={{ animationDelay: "600ms" }}>The Orb is now ready to observe, analyze, and respond.</p>
            </div>
            <Button onClick={handleComplete} className="w-full h-14 rounded-2xl text-base">
              Enter the Orb
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex flex-col px-6 safe-area-top safe-area-bottom">
      {/* Progress */}
      {currentStep !== "welcome" && currentStep !== "complete" && (
        <div className="pt-8 pb-4">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Step {stepIndex} of {steps.length - 2}
          </p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex items-center justify-center py-8">
        <div className="w-full max-w-sm">{renderStep()}</div>
      </div>
    </div>
  );
};

export default Onboarding;
