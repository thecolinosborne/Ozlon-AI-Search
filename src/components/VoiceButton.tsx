import { Mic, Square } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";

interface VoiceButtonProps {
  onVoiceInput?: (text: string) => void;
  className?: string;
}

export const VoiceButton = ({ onVoiceInput, className = "" }: VoiceButtonProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        if (chunksRef.current.length === 0) {
          toast.error("No audio recorded");
          return;
        }

        setIsProcessing(true);
        
        try {
          const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const base64Audio = await blobToBase64(audioBlob);
          
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              },
              body: JSON.stringify({ audio: base64Audio }),
            }
          );

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Transcription failed');
          }

          const { text } = await response.json();
          
          if (text && text.trim()) {
            onVoiceInput?.(text.trim());
          } else {
            toast.error("Could not understand audio");
          }
        } catch (error) {
          console.error('Transcription error:', error);
          toast.error(error instanceof Error ? error.message : "Failed to transcribe");
        } finally {
          setIsProcessing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Microphone access error:', error);
      toast.error("Could not access microphone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleClick = () => {
    if (isProcessing) return;
    
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isProcessing}
      className={`relative w-20 h-20 rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isRecording ? 'animate-pulse' : 'animate-glow-pulse'} ${className}`}
    >
      {isProcessing ? (
        <div className="w-6 h-6 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
      ) : isRecording ? (
        <Square className="w-6 h-6 fill-current" />
      ) : (
        <Mic className="w-8 h-8" />
      )}
      {isRecording && (
        <>
          <span className="absolute inset-0 rounded-full bg-white/30 animate-pulse-soft" />
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex gap-1 items-center">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-primary rounded-full animate-pulse-soft"
                style={{
                  height: `${12 + Math.random() * 12}px`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        </>
      )}
    </button>
  );
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
