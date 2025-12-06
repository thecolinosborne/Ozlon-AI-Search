import { Button } from "@/components/ui/button";
import { OnboardingVoiceButton } from "../OnboardingVoiceButton";

interface PrimaryNeedScreenProps {
  primaryNeed: string;
  onNeedChange: (need: string) => void;
  onContinue: () => void;
}

export const PrimaryNeedScreen = ({
  primaryNeed,
  onNeedChange,
  onContinue,
}: PrimaryNeedScreenProps) => {
  return (
    <div>
      <h1 className="text-3xl font-semibold text-foreground mb-3 tracking-tight">
        What should I make easier for you right now?
      </h1>
      <p className="text-muted-foreground mb-8 text-lg">
        Tell me what's on your mind.
      </p>
      
      <div className="relative mb-8">
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
