import { RotateCcw, VolumeX, Volume2 } from "lucide-react";

interface VoiceControlsProps {
  isSpeaking: boolean;
  onReplay: () => void;
  onSkip: () => void;
}

export const VoiceControls = ({ isSpeaking, onReplay, onSkip }: VoiceControlsProps) => {
  return (
    <div className="flex items-center justify-center gap-4 mt-6">
      <button
        onClick={onReplay}
        disabled={isSpeaking}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-card/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Replay voice prompt"
      >
        <RotateCcw className="w-4 h-4" />
        <span>Replay</span>
      </button>
      
      {isSpeaking && (
        <button
          onClick={onSkip}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-card/60 transition-all"
          aria-label="Skip voice prompt"
        >
          <VolumeX className="w-4 h-4" />
          <span>Skip Audio</span>
        </button>
      )}
      
      {isSpeaking && (
        <div className="flex items-center gap-2 text-sm text-primary">
          <Volume2 className="w-4 h-4 animate-pulse" />
          <span>Speaking...</span>
        </div>
      )}
    </div>
  );
};
