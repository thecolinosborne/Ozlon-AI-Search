import { useCallback, useRef, useState } from "react";

export function useDailyBrief() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
  }, []);

  const play = useCallback(
    (script: string) => {
      setIsOverlayOpen(true);
      setIsPlaying(true);
      // Fallback to native TTS for now; backend brief endpoint will replace this.
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(script);
        u.rate = 1.0;
        u.pitch = 1.0;
        u.onend = () => setIsPlaying(false);
        utteranceRef.current = u;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } else {
        // No TTS available; auto-finish after duration.
        setTimeout(() => setIsPlaying(false), 4000);
      }
    },
    [],
  );

  const close = useCallback(() => {
    stop();
    setIsOverlayOpen(false);
  }, [stop]);

  return { isPlaying, isOverlayOpen, play, stop, close };
}
