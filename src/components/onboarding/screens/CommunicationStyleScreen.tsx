import { Button } from "@/components/ui/button";
import { OnboardingOption } from "../OnboardingOption";

interface CommunicationStyleScreenProps {
  responseLengthPreference: "short" | "medium" | "detailed";
  tonePreference: "casual" | "neutral" | "polished";
  onResponseLengthChange: (length: "short" | "medium" | "detailed") => void;
  onToneChange: (tone: "casual" | "neutral" | "polished") => void;
  onContinue: () => void;
}

export const CommunicationStyleScreen = ({
  responseLengthPreference,
  tonePreference,
  onResponseLengthChange,
  onToneChange,
  onContinue,
}: CommunicationStyleScreenProps) => {
  return (
    <div>
      <h1 className="text-3xl font-semibold text-foreground mb-8 tracking-tight">
        How should I talk with you?
      </h1>
      
      <p className="text-muted-foreground mb-4 text-lg">
        Do you prefer short answers or more detailed explanations?
      </p>
      
      <div className="space-y-3 mb-10">
        <OnboardingOption
          label="Short"
          description="Quick and to the point"
          selected={responseLengthPreference === "short"}
          onClick={() => onResponseLengthChange("short")}
        />
        <OnboardingOption
          label="Medium"
          description="Balanced and clear"
          selected={responseLengthPreference === "medium"}
          onClick={() => onResponseLengthChange("medium")}
        />
        <OnboardingOption
          label="Detailed"
          description="Thorough explanations"
          selected={responseLengthPreference === "detailed"}
          onClick={() => onResponseLengthChange("detailed")}
        />
      </div>
      
      <p className="text-muted-foreground mb-4 text-lg">
        Is your usual tone more casual or more polished?
      </p>
      
      <div className="space-y-3 mb-8">
        <OnboardingOption
          label="Casual"
          description="Friendly and relaxed"
          selected={tonePreference === "casual"}
          onClick={() => onToneChange("casual")}
        />
        <OnboardingOption
          label="Neutral"
          description="Professional but warm"
          selected={tonePreference === "neutral"}
          onClick={() => onToneChange("neutral")}
        />
        <OnboardingOption
          label="Polished"
          description="Refined and formal"
          selected={tonePreference === "polished"}
          onClick={() => onToneChange("polished")}
        />
      </div>
      
      <Button
        onClick={onContinue}
        className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02]"
      >
        Continue
      </Button>
    </div>
  );
};
