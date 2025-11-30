import { Mic } from "lucide-react";
import { useState } from "react";

interface VoiceButtonProps {
  onVoiceInput?: (text: string) => void;
  className?: string;
}

export const VoiceButton = ({ onVoiceInput, className = "" }: VoiceButtonProps) => {
  const [isRecording, setIsRecording] = useState(false);

  const handleClick = () => {
    setIsRecording(!isRecording);
    // Simulate voice input
    if (!isRecording) {
      setTimeout(() => {
        setIsRecording(false);
        onVoiceInput?.("Voice input placeholder");
      }, 2000);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`relative w-20 h-20 rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 ${className}`}
    >
      <Mic className="w-8 h-8" />
      {isRecording && (
        <span className="absolute inset-0 rounded-full bg-primary animate-pulse-soft opacity-50" />
      )}
    </button>
  );
};
