import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'error';

interface UseRealtimeVoiceOptions {
  systemName: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAIResponse?: (text: string) => void;
  onError?: (error: string) => void;
}

export function useRealtimeVoice({
  systemName,
  onTranscript,
  onAIResponse,
  onError,
}: UseRealtimeVoiceOptions) {
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const disconnect = useCallback(() => {
    console.log('Disconnecting realtime voice...');
    
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }
    
    setStatus('idle');
    setIsAISpeaking(false);
    setTranscript('');
  }, []);

  const connect = useCallback(async () => {
    try {
      setStatus('connecting');
      console.log('Starting realtime voice connection...');

      // Get ephemeral token from edge function
      const { data, error } = await supabase.functions.invoke('realtime-session', {
        body: { systemName },
      });

      if (error || !data?.client_secret?.value) {
        throw new Error(error?.message || 'Failed to get realtime session token');
      }

      const EPHEMERAL_KEY = data.client_secret.value;
      console.log('Got ephemeral token');

      // Create peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Set up audio element for AI voice output
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElRef.current = audioEl;

      // Handle remote audio stream (AI voice)
      pc.ontrack = (e) => {
        console.log('Received audio track from AI');
        audioEl.srcObject = e.streams[0];
      };

      // Get user's microphone
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      streamRef.current = stream;

      // Add microphone track to peer connection
      pc.addTrack(stream.getTracks()[0]);

      // Set up data channel for events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      let currentResponseText = '';

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          console.log('Realtime event:', event.type);

          switch (event.type) {
            case 'session.created':
              console.log('Session created');
              setStatus('connected');
              break;

            case 'input_audio_buffer.speech_started':
              setStatus('listening');
              setIsAISpeaking(false);
              break;

            case 'input_audio_buffer.speech_stopped':
              setStatus('connected');
              break;

            case 'conversation.item.input_audio_transcription.completed':
              const userText = event.transcript;
              if (userText) {
                setTranscript(userText);
                onTranscript?.(userText, true);
              }
              break;

            case 'response.audio_transcript.delta':
              currentResponseText += event.delta || '';
              onAIResponse?.(currentResponseText);
              break;

            case 'response.audio.delta':
              setIsAISpeaking(true);
              setStatus('speaking');
              break;

            case 'response.audio.done':
              setIsAISpeaking(false);
              setStatus('connected');
              break;

            case 'response.done':
              if (currentResponseText) {
                onAIResponse?.(currentResponseText);
              }
              currentResponseText = '';
              setStatus('connected');
              break;

            case 'error':
              console.error('Realtime API error:', event.error);
              onError?.(event.error?.message || 'Unknown error');
              break;
          }
        } catch (err) {
          console.error('Error parsing realtime event:', err);
        }
      };

      dc.onopen = () => {
        console.log('Data channel opened');
        // Enable input audio transcription
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            input_audio_transcription: {
              model: 'whisper-1',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 800,
            },
          },
        }));
      };

      dc.onclose = () => {
        console.log('Data channel closed');
        setStatus('idle');
      };

      // Create and set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Connect to OpenAI's Realtime API
      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = 'gpt-4o-realtime-preview-2024-12-17';
      
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`Failed to connect to OpenAI: ${sdpResponse.status}`);
      }

      const answer = {
        type: 'answer' as RTCSdpType,
        sdp: await sdpResponse.text(),
      };

      await pc.setRemoteDescription(answer);
      console.log('WebRTC connection established');
      setStatus('connected');

    } catch (error) {
      console.error('Error connecting to realtime voice:', error);
      setStatus('error');
      onError?.(error instanceof Error ? error.message : 'Connection failed');
      disconnect();
    }
  }, [systemName, onTranscript, onAIResponse, onError, disconnect]);

  const sendTextMessage = useCallback((text: string) => {
    if (!dcRef.current || dcRef.current.readyState !== 'open') {
      console.error('Data channel not ready');
      return;
    }

    dcRef.current.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    }));

    dcRef.current.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  return {
    status,
    isAISpeaking,
    transcript,
    connect,
    disconnect,
    sendTextMessage,
    isConnected: status === 'connected' || status === 'speaking' || status === 'listening',
  };
}
