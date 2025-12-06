import { Button } from "@/components/ui/button";
import { OnboardingInput } from "../OnboardingInput";
import { AIOrb } from "@/components/AIOrb";

interface WelcomeScreenProps {
  name: string;
  onNameChange: (name: string) => void;
  onContinue: () => void;
  isSpeaking?: boolean;
}

export const WelcomeScreen = ({ name, onNameChange, onContinue, isSpeaking = false }: WelcomeScreenProps) => {
  return (
    <div className="text-center">
      <div className="flex justify-center mb-10">
        <div className="scale-150">
          <AIOrb breatheIn={true} isSpeaking={isSpeaking} size="lg" />
        </div>
      </div>
      
      <h1 className="text-3xl font-semibold text-foreground mb-3 tracking-tight">
        Hey, I'm Ozlon.
      </h1>
      <p className="text-xl text-foreground/80 mb-2">
        I'm here for you.
      </p>
      <p className="text-muted-foreground mb-10 text-lg">
        Before we get started, what should I call you?
      </p>
      
      <OnboardingInput
        value={name}
        onChange={onNameChange}
        onVoiceInput={onNameChange}
        placeholder="Your name"
        className="mb-8"
      />
      
      <Button
        onClick={onContinue}
        disabled={!name.trim()}
        className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02]"
      >
        Continue
      </Button>
    </div>
  );
};
