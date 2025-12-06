import { Button } from "@/components/ui/button";
import { OnboardingOption } from "../OnboardingOption";
import { AIOrb } from "@/components/AIOrb";
import { VoiceControls } from "../VoiceControls";

interface ProactivityScreenProps {
  proactivityPreference: "immediate" | "wait" | "judgment" | null;
  onProactivityChange: (preference: "immediate" | "wait" | "judgment") => void;
  onContinue: () => void;
  isSpeaking?: boolean;
  onReplay?: () => void;
  onSkipAudio?: () => void;
}

export const ProactivityScreen = ({
  proactivityPreference,
  onProactivityChange,
  onContinue,
  isSpeaking = false,
  onReplay,
  onSkipAudio,
}: ProactivityScreenProps) => {
  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <AIOrb isSpeaking={isSpeaking} size="md" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            When I notice something helpful...
          </h1>
        </div>
      </div>
      
      <p className="text-muted-foreground mb-4 text-lg">
        Should I tell you right away, wait until you ask, or use my judgment?
      </p>
      
      {onReplay && onSkipAudio && (
        <VoiceControls 
          isSpeaking={isSpeaking} 
          onReplay={onReplay} 
          onSkip={onSkipAudio} 
        />
      )}
      
      <div className="space-y-3 mb-8 mt-6">
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
