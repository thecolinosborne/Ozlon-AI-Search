import { useState } from 'react';
import { Phone, PhoneOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRealtimeVoice } from '@/hooks/useRealtimeVoice';
import { toast } from 'sonner';

interface RealtimeVoiceChatProps {
  systemName: string;
  onClose?: () => void;
}

export function RealtimeVoiceChat({ systemName, onClose }: RealtimeVoiceChatProps) {
  const [userTranscript, setUserTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');

  const {
    status,
    isAISpeaking,
    connect,
    disconnect,
    isConnected,
  } = useRealtimeVoice({
    systemName,
    onTranscript: (text) => {
      setUserTranscript(text);
    },
    onAIResponse: (text) => {
      setAiResponse(text);
    },
    onError: (error) => {
      toast.error(error);
    },
  });

  const handleToggleCall = async () => {
    if (isConnected) {
      disconnect();
      onClose?.();
    } else {
      setUserTranscript('');
      setAiResponse('');
      await connect();
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return 'Listening...';
      case 'speaking':
        return `${systemName} is speaking...`;
      case 'listening':
        return 'You are speaking...';
      case 'error':
        return 'Connection error';
      default:
        return 'Start conversation';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
      {/* Close button */}
      <button
        onClick={() => {
          disconnect();
          onClose?.();
        }}
        className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors text-sm"
      >
        Close
      </button>

      {/* System name */}
      <h1 className="text-white text-3xl font-light mb-2">{systemName}</h1>
      <p className="text-white/60 text-sm mb-12">Real-time voice conversation</p>

      {/* Animated orb */}
      <div className="relative mb-12">
        <div
          className={cn(
            'w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300',
            isConnected
              ? isAISpeaking
                ? 'bg-blue-500 animate-pulse'
                : status === 'listening'
                ? 'bg-green-500 animate-pulse'
                : 'bg-blue-500/80'
              : 'bg-neutral-700'
          )}
        >
          {status === 'connecting' ? (
            <Loader2 className="w-12 h-12 text-white animate-spin" />
          ) : (
            <div
              className={cn(
                'w-16 h-16 rounded-full bg-white/20',
                isAISpeaking && 'animate-ping'
              )}
            />
          )}
        </div>
        
        {/* Outer rings for speaking animation */}
        {isAISpeaking && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-blue-400/50 animate-ping" />
            <div
              className="absolute inset-0 rounded-full border border-blue-400/30 animate-ping"
              style={{ animationDelay: '0.2s' }}
            />
          </>
        )}
        
        {status === 'listening' && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-green-400/50 animate-ping" />
          </>
        )}
      </div>

      {/* Status text */}
      <p className="text-white/80 text-lg mb-4">{getStatusText()}</p>

      {/* Transcripts */}
      <div className="w-full max-w-md space-y-4 mb-12 min-h-[100px]">
        {userTranscript && (
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-white/50 text-xs mb-1">You said:</p>
            <p className="text-white text-sm">{userTranscript}</p>
          </div>
        )}
        {aiResponse && (
          <div className="bg-blue-500/20 rounded-lg p-3">
            <p className="text-blue-300/70 text-xs mb-1">{systemName}:</p>
            <p className="text-white text-sm">{aiResponse}</p>
          </div>
        )}
      </div>

      {/* Call button */}
      <button
        onClick={handleToggleCall}
        disabled={status === 'connecting'}
        className={cn(
          'w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300',
          isConnected
            ? 'bg-red-500 hover:bg-red-600'
            : 'bg-green-500 hover:bg-green-600',
          status === 'connecting' && 'opacity-50 cursor-not-allowed'
        )}
      >
        {isConnected ? (
          <PhoneOff className="w-7 h-7 text-white" />
        ) : (
          <Phone className="w-7 h-7 text-white" />
        )}
      </button>

      <p className="text-white/40 text-xs mt-4">
        {isConnected ? 'Tap to end call' : 'Tap to start'}
      </p>
    </div>
  );
}
