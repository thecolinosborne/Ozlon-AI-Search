import { Button } from "@/components/ui/button";
import { OnboardingVoiceButton } from "../OnboardingVoiceButton";
import { AIOrb } from "@/components/AIOrb";
import { VoiceControls } from "../VoiceControls";

interface PrimaryNeedScreenProps {
  primaryNeed: string;
  onNeedChange: (need: string) => void;
  onContinue: () => void;
  isSpeaking?: boolean;
  onReplay?: () => void;
  onSkipAudio?: () => void;
}

export const PrimaryNeedScreen = ({
  primaryNeed,
  onNeedChange,
  onContinue,
  isSpeaking = false,
  onReplay,
  onSkipAudio,
}: PrimaryNeedScreenProps) => {
  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <AIOrb isSpeaking={isSpeaking} size="md" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            If I could make one thing easier...
          </h1>
        </div>
      </div>
      
      <p className="text-muted-foreground mb-4 text-lg">
        What would it be?
      </p>
      
      {onReplay && onSkipAudio && (
        <VoiceControls 
          isSpeaking={isSpeaking} 
          onReplay={onReplay} 
          onSkip={onSkipAudio} 
        />
      )}
      
      <div className="relative mb-8 mt-6">
        <textarea
          value={primaryNeed}
          onChange={(e) => onNeedChange(e.target.value)}
          placeholder="stress, focus, staying organized, money, relationships..."
          rows={4}
          className="w-full px-5 py-4 rounded-2xl bg-card/60 border border-border/40 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all text-lg resize-none"
        />
        <div className="absolute bottom-4 right-4">
          <OnboardingVoiceButton 
            onVoiceInput={(text) => onNeedChange(primaryNeed ? `${primaryNeed} ${text}` : text)} 
            size="sm"
          />
        </div>
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
