import { supabase } from "@/integrations/supabase/client";

export interface VoiceSettings {
  tts_provider: 'elevenlabs' | 'playht' | 'auto';
  voice_id: string | null;
  elevenlabs_voice_id: string | null;
  playht_voice_id: string | null;
  auto_play_responses: boolean;
  voice_cloning_status: 'none' | 'pending' | 'ready' | 'failed';
  is_premium: boolean;
}

export interface AvailableVoice {
  id: string;
  name: string;
  description: string;
  premium: boolean;
}

// Audio playback state
let currentAudio: HTMLAudioElement | null = null;

export const voiceService = {
  /**
   * Synthesize text to speech and return audio URL
   */
  async synthesize(text: string, voiceId?: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke('text-to-speech', {
      body: { text, voiceId },
    });

    if (error) {
      console.error('TTS error:', error);
      throw new Error(error.message || 'Failed to synthesize speech');
    }

    if (!data?.audioContent) {
      throw new Error('No audio content received');
    }

    // Convert base64 to audio URL
    const audioBlob = base64ToBlob(data.audioContent, 'audio/mpeg');
    return URL.createObjectURL(audioBlob);
  },

  /**
   * Play audio from URL
   */
  async play(audioUrl: string): Promise<void> {
    // Stop any currently playing audio
    this.stop();

    return new Promise((resolve, reject) => {
      currentAudio = new Audio(audioUrl);
      
      currentAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        resolve();
      };

      currentAudio.onerror = (e) => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        reject(new Error('Audio playback failed'));
      };

      currentAudio.play().catch(reject);
    });
  },

  /**
   * Stop current audio playback
   */
  stop(): void {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  },

  /**
   * Check if audio is currently playing
   */
  isPlaying(): boolean {
    return currentAudio !== null && !currentAudio.paused;
  },

  /**
   * Synthesize and play text
   */
  async speak(text: string, voiceId?: string): Promise<void> {
    const audioUrl = await this.synthesize(text, voiceId);
    await this.play(audioUrl);
  },

  /**
   * Get user voice settings
   */
  async getSettings(): Promise<{ settings: VoiceSettings; availableVoices: AvailableVoice[] }> {
    const { data, error } = await supabase.functions.invoke('voice-settings', {
      method: 'GET',
    });

    if (error) {
      throw new Error(error.message || 'Failed to fetch voice settings');
    }

    return data;
  },

  /**
   * Update user voice settings
   */
  async updateSettings(settings: Partial<VoiceSettings>): Promise<VoiceSettings> {
    const { data, error } = await supabase.functions.invoke('voice-settings', {
      body: settings,
    });

    if (error) {
      throw new Error(error.message || 'Failed to update voice settings');
    }

    return data.settings;
  },

  /**
   * Clone user's voice from audio sample
   */
  async cloneVoice(audioBase64: string, name?: string): Promise<{ voiceId: string }> {
    const { data, error } = await supabase.functions.invoke('voice-clone', {
      body: { audio: audioBase64, name },
    });

    if (error) {
      throw new Error(error.message || 'Voice cloning failed');
    }

    return data;
  },

  /**
   * Get voice cloning status
   */
  async getCloningStatus(): Promise<{ status: string; voiceId: string | null }> {
    const { data, error } = await supabase.functions.invoke('voice-clone', {
      method: 'GET',
    });

    if (error) {
      throw new Error(error.message || 'Failed to fetch cloning status');
    }

    return data;
  },

  /**
   * Record audio from microphone
   */
  async recordAudio(durationMs: number = 30000): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            sampleRate: 44100,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          } 
        });

        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
        });

        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          
          const audioBlob = new Blob(chunks, { type: 'audio/webm' });
          const base64 = await blobToBase64(audioBlob);
          resolve(base64);
        };

        mediaRecorder.onerror = (e) => {
          stream.getTracks().forEach(track => track.stop());
          reject(new Error('Recording failed'));
        };

        mediaRecorder.start();

        // Auto-stop after duration
        setTimeout(() => {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }, durationMs);

      } catch (err) {
        reject(err);
      }
    });
  },
};

// Helper functions
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

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
