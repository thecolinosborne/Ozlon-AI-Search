import { useState, useCallback } from "react";
import { voiceService } from "@/services/voiceService";
import { toast } from "sonner";

export function useVoicePlayback() {
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);

  const playMessage = useCallback(async (messageId: string, text: string) => {
    if (playingMessageId === messageId) {
      voiceService.stop();
      setPlayingMessageId(null);
      return;
    }

    setLoadingAudioId(messageId);
    try {
      setPlayingMessageId(messageId);
      await voiceService.speak(text);
    } catch (error) {
      console.error("Playback error:", error);
      toast.error("Could not play voice");
    } finally {
      setPlayingMessageId(null);
      setLoadingAudioId(null);
    }
  }, [playingMessageId]);

  return { playingMessageId, loadingAudioId, playMessage };
}
