import { useState, useCallback, useRef, useEffect } from "react";
import { voiceService } from "@/services/voiceService";
import { toast } from "sonner";

export function useVoicePlayback() {
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      voiceService.stop();
    };
  }, []);

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
      if (mountedRef.current) {
        setPlayingMessageId(null);
        setLoadingAudioId(null);
      }
    }
  }, [playingMessageId]);

  return { playingMessageId, loadingAudioId, playMessage };
}
