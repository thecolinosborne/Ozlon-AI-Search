import { cn } from "@/lib/utils";
import { OnboardingVoiceButton } from "./OnboardingVoiceButton";

interface OnboardingInputProps {
  value: string;
  onChange: (value: string) => void;
  onVoiceInput: (text: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export const OnboardingInput = ({
  value,
  onChange,
  onVoiceInput,
  placeholder = "Type or speak...",
  className = "",
  autoFocus = true,
}: OnboardingInputProps) => {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="flex-1 h-14 px-5 rounded-2xl bg-card/60 border border-border/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all text-lg"
      />
      <OnboardingVoiceButton onVoiceInput={onVoiceInput} />
    </div>
  );
};
