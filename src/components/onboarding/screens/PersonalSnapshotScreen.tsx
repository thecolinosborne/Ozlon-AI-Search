import { Button } from "@/components/ui/button";
import { OnboardingVoiceButton } from "../OnboardingVoiceButton";

interface PersonalSnapshotScreenProps {
  name: string;
  personalNotes: string;
  onNotesChange: (notes: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}

export const PersonalSnapshotScreen = ({
  name,
  personalNotes,
  onNotesChange,
  onContinue,
  onSkip,
}: PersonalSnapshotScreenProps) => {
  return (
    <div>
      <h1 className="text-3xl font-semibold text-foreground mb-3 tracking-tight">
        Good to meet you, {name}.
      </h1>
      <p className="text-muted-foreground mb-8 text-lg leading-relaxed">
        Is there anything important about you or your life that I should keep in mind?
      </p>
      
      <div className="relative mb-8">
        <textarea
          value={personalNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Anything you'd like to share..."
          rows={4}
          className="w-full px-5 py-4 rounded-2xl bg-card/60 border border-border/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all text-lg resize-none"
        />
        <div className="absolute bottom-4 right-4">
          <OnboardingVoiceButton 
            onVoiceInput={(text) => onNotesChange(personalNotes ? `${personalNotes} ${text}` : text)} 
            size="sm"
          />
        </div>
      </div>
      
      <div className="space-y-3">
        <Button
          onClick={onContinue}
          className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02]"
        >
          Continue
        </Button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-muted-foreground hover:text-foreground transition-colors text-base"
        >
          Not right now
        </button>
      </div>
    </div>
  );
};
