import { Button } from "@/components/ui/button";
import { OnboardingInput } from "../OnboardingInput";
import { AIOrb } from "@/components/AIOrb";
import { VoiceControls } from "../VoiceControls";

interface WelcomeScreenProps {
  firstName: string;
  lastName: string;
  email: string;
  onFirstNameChange: (name: string) => void;
  onLastNameChange: (name: string) => void;
  onContinue: () => void;
  isSpeaking?: boolean;
  onReplay?: () => void;
  onSkipAudio?: () => void;
}

export const WelcomeScreen = ({ 
  firstName,
  lastName,
  email,
  onFirstNameChange,
  onLastNameChange,
  onContinue, 
  isSpeaking = false,
  onReplay,
  onSkipAudio,
}: WelcomeScreenProps) => {
  const canContinue = firstName.trim().length > 0 && lastName.trim().length > 0;

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
      <p className="text-muted-foreground mb-6 text-lg">
        Let's get to know each other.
      </p>
      
      {onReplay && onSkipAudio && (
        <VoiceControls 
          isSpeaking={isSpeaking} 
          onReplay={onReplay} 
          onSkip={onSkipAudio} 
        />
      )}
      
      <div className="space-y-3 mt-6 mb-4">
        <OnboardingInput
          value={firstName}
          onChange={onFirstNameChange}
          onVoiceInput={onFirstNameChange}
          placeholder="First name"
          autoFocus={true}
        />
        <OnboardingInput
          value={lastName}
          onChange={onLastNameChange}
          onVoiceInput={onLastNameChange}
          placeholder="Last name"
          autoFocus={false}
        />
      </div>

      {/* Email (read-only from auth) */}
      {email && (
        <div className="mb-8">
          <input
            type="text"
            value={email}
            readOnly
            className="w-full h-14 px-5 rounded-2xl bg-muted/40 border border-border/30 text-muted-foreground text-lg cursor-default focus:outline-none"
          />
        </div>
      )}
      
      <Button
        onClick={onContinue}
        disabled={!canContinue}
        className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02]"
      >
        Continue
      </Button>
    </div>
  );
};