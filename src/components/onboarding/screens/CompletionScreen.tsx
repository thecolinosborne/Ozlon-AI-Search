import { Button } from "@/components/ui/button";
import { AIOrb } from "@/components/AIOrb";

interface CompletionScreenProps {
  name: string;
  interactionPreference: "typing" | "talking" | "both" | null;
  onComplete: () => void;
  isSpeaking?: boolean;
}

export const CompletionScreen = ({
  name,
  interactionPreference,
  onComplete,
  isSpeaking = false,
}: CompletionScreenProps) => {
  return (
    <div className="text-center">
      <div className="flex justify-center mb-10">
        <div className="scale-150">
          <AIOrb breatheIn={true} isSpeaking={isSpeaking} size="lg" />
        </div>
      </div>
      
      <h1 className="text-3xl font-semibold text-foreground mb-4 tracking-tight">
        Perfect.
      </h1>
      
      <p className="text-lg text-muted-foreground mb-10 leading-relaxed max-w-sm mx-auto">
        I'll use everything you shared to make things easier for you starting now.
      </p>
      
      <div className="space-y-2 mb-10 text-left px-4">
        <p className="text-muted-foreground animate-fade-in" style={{ animationDelay: "0ms" }}>
          Your preferences have been saved.
        </p>
        <p className="text-muted-foreground animate-fade-in" style={{ animationDelay: "200ms" }}>
          Your communication style is configured.
        </p>
        <p className="text-muted-foreground animate-fade-in" style={{ animationDelay: "400ms" }}>
          I'm ready to help you, {name}.
        </p>
      </div>
      
      <Button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onComplete();
        }}
        className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
      >
        {interactionPreference === "talking" ? "Start Talking" : "Start Chatting"}
      </Button>
    </div>
  );
};
