import { Button } from "@/components/ui/button";
import { Keyboard, Mic, MessageCircle } from "lucide-react";
import { AIOrb } from "@/components/AIOrb";
import { VoiceControls } from "../VoiceControls";

interface InteractionPreferenceScreenProps {
  interactionPreference: "typing" | "talking" | "both" | null;
  onInteractionChange: (preference: "typing" | "talking" | "both") => void;
  onContinue: () => void;
  isSpeaking?: boolean;
  onReplay?: () => void;
  onSkipAudio?: () => void;
}

export const InteractionPreferenceScreen = ({
  interactionPreference,
  onInteractionChange,
  onContinue,
  isSpeaking = false,
  onReplay,
  onSkipAudio,
}: InteractionPreferenceScreenProps) => {
  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <AIOrb isSpeaking={isSpeaking} size="md" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            How do you prefer to talk with me?
          </h1>
        </div>
      </div>
      
      <p className="text-muted-foreground mb-4 text-lg">
        Typing, talking, or both? You can always change this later.
      </p>
      
      {onReplay && onSkipAudio && (
        <VoiceControls 
          isSpeaking={isSpeaking} 
          onReplay={onReplay} 
          onSkip={onSkipAudio} 
        />
      )}
      
      <div className="space-y-3 mb-8 mt-6">
        <button
          onClick={() => onInteractionChange("typing")}
          className={`w-full p-6 rounded-2xl text-left transition-all duration-300 border flex items-center gap-4 ${
            interactionPreference === "typing"
              ? "bg-primary/10 border-primary/40"
              : "bg-card/40 border-border/30 hover:bg-card/60"
          }`}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            interactionPreference === "typing" ? "bg-primary/20" : "bg-muted"
          }`}>
            <Keyboard className={`w-6 h-6 ${
              interactionPreference === "typing" ? "text-primary" : "text-muted-foreground"
            }`} />
          </div>
          <div>
            <span className={`font-medium text-lg ${
              interactionPreference === "typing" ? "text-primary" : "text-foreground"
            }`}>
              Typing
            </span>
            <p className="text-sm text-muted-foreground">I prefer text conversations</p>
          </div>
        </button>
        
        <button
          onClick={() => onInteractionChange("talking")}
          className={`w-full p-6 rounded-2xl text-left transition-all duration-300 border flex items-center gap-4 ${
            interactionPreference === "talking"
              ? "bg-primary/10 border-primary/40"
              : "bg-card/40 border-border/30 hover:bg-card/60"
          }`}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            interactionPreference === "talking" ? "bg-primary/20" : "bg-muted"
          }`}>
            <Mic className={`w-6 h-6 ${
              interactionPreference === "talking" ? "text-primary" : "text-muted-foreground"
            }`} />
          </div>
          <div>
            <span className={`font-medium text-lg ${
              interactionPreference === "talking" ? "text-primary" : "text-foreground"
            }`}>
              Talking
            </span>
            <p className="text-sm text-muted-foreground">I prefer voice conversations</p>
          </div>
        </button>
        
        <button
          onClick={() => onInteractionChange("both")}
          className={`w-full p-6 rounded-2xl text-left transition-all duration-300 border flex items-center gap-4 ${
            interactionPreference === "both"
              ? "bg-primary/10 border-primary/40"
              : "bg-card/40 border-border/30 hover:bg-card/60"
          }`}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            interactionPreference === "both" ? "bg-primary/20" : "bg-muted"
          }`}>
            <MessageCircle className={`w-6 h-6 ${
              interactionPreference === "both" ? "text-primary" : "text-muted-foreground"
            }`} />
          </div>
          <div>
            <span className={`font-medium text-lg ${
              interactionPreference === "both" ? "text-primary" : "text-foreground"
            }`}>
              Both
            </span>
            <p className="text-sm text-muted-foreground">I'll use whatever feels right</p>
          </div>
        </button>
      </div>
      
      <Button
        onClick={onContinue}
        disabled={!interactionPreference}
        className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02]"
      >
        Continue
      </Button>
    </div>
  );
};
