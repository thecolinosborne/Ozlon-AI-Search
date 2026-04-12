import { Button } from "@/components/ui/button";
import { OnboardingInput } from "../OnboardingInput";
import { AIOrb } from "@/components/AIOrb";
import { VoiceControls } from "../VoiceControls";

interface NamingScreenProps {
  systemName: string;
  onSystemNameChange: (name: string) => void;
  onContinue: () => void;
  isSpeaking?: boolean;
  onReplay?: () => void;
  onSkipAudio?: () => void;
}

export const NamingScreen = ({
  systemName,
  onSystemNameChange,
  onContinue,
  isSpeaking = false,
  onReplay,
  onSkipAudio,
}: NamingScreenProps) => {
  return (
    <div className="text-center">
      <div className="flex justify-center mb-10">
        <div className="scale-150">
          <AIOrb breatheIn={true} isSpeaking={isSpeaking} size="lg" />
        </div>
      </div>

      <h1 className="text-3xl font-semibold text-foreground mb-3 tracking-tight">
        What should I be called?
      </h1>
      <p className="text-muted-foreground mb-6 text-lg">
        Give me a name, or keep the default.
      </p>

      {onReplay && onSkipAudio && (
        <VoiceControls
          isSpeaking={isSpeaking}
          onReplay={onReplay}
          onSkip={onSkipAudio}
        />
      )}

      <OnboardingInput
        value={systemName}
        onChange={onSystemNameChange}
        onVoiceInput={onSystemNameChange}
        placeholder="Ozlon"
        className="mb-8 mt-6"
        autoFocus={true}
      />

      <Button
        onClick={onContinue}
        className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02]"
      >
        Continue
      </Button>
    </div>
  );
};