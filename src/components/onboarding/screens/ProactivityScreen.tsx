import { Button } from "@/components/ui/button";
import { OnboardingOption } from "../OnboardingOption";

interface ProactivityScreenProps {
  proactivityPreference: "immediate" | "wait" | "judgment" | null;
  onProactivityChange: (preference: "immediate" | "wait" | "judgment") => void;
  onContinue: () => void;
}

export const ProactivityScreen = ({
  proactivityPreference,
  onProactivityChange,
  onContinue,
}: ProactivityScreenProps) => {
  return (
    <div>
      <h1 className="text-3xl font-semibold text-foreground mb-3 tracking-tight">
        When I notice something helpful...
      </h1>
      <p className="text-muted-foreground mb-8 text-lg">
        How would you like me to reach out?
      </p>
      
      <div className="space-y-3 mb-8">
        <OnboardingOption
          label="Tell me right away"
          description="I'll share insights as soon as I notice them"
          selected={proactivityPreference === "immediate"}
          onClick={() => onProactivityChange("immediate")}
        />
        <OnboardingOption
          label="Wait until I ask"
          description="I'll keep notes and share when you're ready"
          selected={proactivityPreference === "wait"}
          onClick={() => onProactivityChange("wait")}
        />
        <OnboardingOption
          label="Use your judgment"
          description="I'll decide based on importance and timing"
          selected={proactivityPreference === "judgment"}
          onClick={() => onProactivityChange("judgment")}
        />
      </div>
      
      <Button
        onClick={onContinue}
        disabled={!proactivityPreference}
        className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02]"
      >
        Continue
      </Button>
    </div>
  );
};
