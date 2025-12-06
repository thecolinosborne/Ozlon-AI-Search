import { Mic, Square } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface OnboardingVoiceButtonProps {
  onVoiceInput: (text: string) => void;
  size?: "sm" | "md";
  className?: string;
}

export const OnboardingVoiceButton = ({ 
  onVoiceInput, 
  size = "md",
  className = "" 
}: OnboardingVoiceButtonProps) => {
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
            onVoiceInput(text.trim());
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

  const sizeClasses = size === "sm" 
    ? "w-12 h-12" 
    : "w-14 h-14";

  const iconSize = size === "sm" ? "w-5 h-5" : "w-6 h-6";

  return (
    <button
      onClick={handleClick}
      disabled={isProcessing}
      className={cn(
        "relative rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center transition-all duration-300 hover:bg-primary/20 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
        isRecording && "bg-primary text-primary-foreground border-primary animate-pulse",
        sizeClasses,
        className
      )}
    >
      {isProcessing ? (
        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : isRecording ? (
        <Square className="w-4 h-4 fill-current" />
      ) : (
        <Mic className={iconSize} />
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
