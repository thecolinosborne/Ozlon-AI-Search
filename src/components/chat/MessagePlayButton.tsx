import { useState } from "react";
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { voiceService } from "@/services/voiceService";
import { handleError } from "@/lib/handleError";

interface MessagePlayButtonProps {
  text: string;
  className?: string;
}

export const MessagePlayButton = ({ text, className }: MessagePlayButtonProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handlePlay = async () => {
    if (isPlaying) {
      voiceService.stop();
      setIsPlaying(false);
      return;
    }

    setIsLoading(true);
    try {
      setIsPlaying(true);
      await voiceService.speak(text);
    } catch (error) {
      handleError(error, "Could not play voice, please try again");
    } finally {
      setIsPlaying(false);
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handlePlay}
      disabled={isLoading}
      className={`h-7 w-7 p-0 opacity-60 hover:opacity-100 transition-opacity ${className}`}
      title={isPlaying ? "Stop" : "Play"}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isPlaying ? (
        <VolumeX className="h-4 w-4" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </Button>
  );
};
