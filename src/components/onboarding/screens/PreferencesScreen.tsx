import { Button } from "@/components/ui/button";
import { OnboardingOption } from "../OnboardingOption";
import { AIOrb } from "@/components/AIOrb";
import { VoiceControls } from "../VoiceControls";

interface PreferencesScreenProps {
  responseLengthPreference: "short" | "medium" | "detailed";
  tonePreference: "casual" | "neutral" | "polished";
  interactionPreference: "typing" | "talking" | "both";
  onResponseLengthChange: (pref: "short" | "medium" | "detailed") => void;
  onToneChange: (pref: "casual" | "neutral" | "polished") => void;
  onInteractionChange: (pref: "typing" | "talking" | "both") => void;
  onContinue: () => void;
  isSpeaking?: boolean;
  onReplay?: () => void;
  onSkipAudio?: () => void;
}

export const PreferencesScreen = ({
  responseLengthPreference,
  tonePreference,
  interactionPreference,
  onResponseLengthChange,
  onToneChange,
  onInteractionChange,
  onContinue,
  isSpeaking = false,
  onReplay,
  onSkipAudio,
}: PreferencesScreenProps) => {
  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <AIOrb isSpeaking={isSpeaking} size="md" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            How should I communicate?
          </h1>
        </div>
      </div>

      {onReplay && onSkipAudio && (
        <VoiceControls
          isSpeaking={isSpeaking}
          onReplay={onReplay}
          onSkip={onSkipAudio}
        />
      )}

      {/* Response Length */}
      <p className="text-muted-foreground mb-3 mt-4 text-base font-medium">Response style</p>
      <div className="space-y-2 mb-6">
        <OnboardingOption
          label="Short & direct"
          description="Get to the point quickly"
          selected={responseLengthPreference === "short"}
          onClick={() => onResponseLengthChange("short")}
        />
        <OnboardingOption
          label="Balanced"
          description="A good mix of detail and brevity"
          selected={responseLengthPreference === "medium"}
          onClick={() => onResponseLengthChange("medium")}
        />
        <OnboardingOption
          label="Detailed"
          description="Thorough explanations and context"
          selected={responseLengthPreference === "detailed"}
          onClick={() => onResponseLengthChange("detailed")}
        />
      </div>

      {/* Tone */}
      <p className="text-muted-foreground mb-3 text-base font-medium">Tone</p>
      <div className="space-y-2 mb-6">
        <OnboardingOption
          label="Casual"
          description="Friendly and relaxed"
          selected={tonePreference === "casual"}
          onClick={() => onToneChange("casual")}
        />
        <OnboardingOption
          label="Neutral"
          description="Clear and balanced"
          selected={tonePreference === "neutral"}
          onClick={() => onToneChange("neutral")}
        />
        <OnboardingOption
          label="Polished"
          description="Professional and refined"
          selected={tonePreference === "polished"}
          onClick={() => onToneChange("polished")}
        />
      </div>

      {/* Interaction */}
      <p className="text-muted-foreground mb-3 text-base font-medium">How do you prefer to interact?</p>
      <div className="space-y-2 mb-8">
        <OnboardingOption
          label="Typing"
          description="Text-based chat"
          selected={interactionPreference === "typing"}
          onClick={() => onInteractionChange("typing")}
        />
        <OnboardingOption
          label="Talking"
          description="Voice conversations"
          selected={interactionPreference === "talking"}
          onClick={() => onInteractionChange("talking")}
        />
        <OnboardingOption
          label="Both"
          description="Mix of text and voice"
          selected={interactionPreference === "both"}
          onClick={() => onInteractionChange("both")}
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
