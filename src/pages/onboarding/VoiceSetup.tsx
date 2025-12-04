import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Volume2, Mic, Sparkles, ArrowRight, Loader2, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { voiceService, AvailableVoice } from "@/services/voiceService";
import { toast } from "sonner";

type VoiceMode = 'standard' | 'clone' | 'premium';

const SAMPLE_SENTENCES = [
  "Hello, my name is user and I am recording my voice for Ozlon.",
  "Today is a beautiful day and I am excited to get started.",
  "This is a test of my voice cloning sample for the assistant.",
];

export default function VoiceSetup() {
  const navigate = useNavigate();
  const [selectedMode, setSelectedMode] = useState<VoiceMode | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);

  const standardVoices: AvailableVoice[] = [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Warm & natural', premium: false },
    { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', description: 'Expressive & dynamic', premium: false },
    { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', description: 'Confident', premium: false },
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Professional', premium: false },
  ];

  const handleModeSelect = (mode: VoiceMode) => {
    setSelectedMode(mode);
    if (mode === 'standard') {
      setSelectedVoice(standardVoices[0].id);
    }
  };

  const handleVoiceSelect = async (voiceId: string) => {
    setSelectedVoice(voiceId);
    const voice = standardVoices.find(v => v.id === voiceId);
    if (voice) {
      toast.success(`Voice set to ${voice.name}`);
    }
    // Preview the voice
    try {
      await voiceService.speak("Hello, I am your Ozlon assistant.", voiceId);
    } catch (error) {
      console.error('Preview error:', error);
    }
  };

  const handleRecordVoice = async () => {
    setIsRecording(true);
    setRecordingProgress(0);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setRecordingProgress(prev => Math.min(prev + 10, 90));
      }, 1500);

      const audioBase64 = await voiceService.recordAudio(15000); // 15 seconds
      
      clearInterval(progressInterval);
      setRecordingProgress(100);
      setIsRecording(false);
      setIsProcessing(true);

      // Clone the voice
      await voiceService.cloneVoice(audioBase64, 'My Voice');
      
      toast.success("Voice cloned successfully");
      setIsComplete(true);
    } catch (error) {
      console.error('Recording/cloning error:', error);
      toast.error("Voice cloning failed, please try again");
    } finally {
      setIsRecording(false);
      setIsProcessing(false);
    }
  };

  const handleContinue = async () => {
    if (selectedMode === 'standard' && selectedVoice) {
      try {
        await voiceService.updateSettings({
          elevenlabs_voice_id: selectedVoice,
          voice_id: selectedVoice,
        });
      } catch (error) {
        console.error('Settings update error:', error);
      }
    }
    navigate('/');
  };

  const handleSkip = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header with Back Button */}
      <header className="border-b border-border/50 px-4 py-4 safe-area-top">
        <div className="max-w-md mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Voice Setup</h1>
            <p className="text-xs text-muted-foreground">Configure voice output</p>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-medium text-foreground mb-2">
            How should Ozlon talk to you?
          </h1>
          <p className="text-muted-foreground text-sm">
            Choose how you want to hear responses
          </p>
        </div>

        {/* Mode Selection */}
        {!selectedMode && (
          <div className="w-full space-y-3">
            <button
              onClick={() => handleModeSelect('standard')}
              className="w-full p-4 rounded-xl bg-card border border-border/50 hover:border-primary/50 transition-all text-left flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Volume2 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Standard Voice</p>
                <p className="text-sm text-muted-foreground">Choose from natural AI voices</p>
              </div>
            </button>

            <button
              onClick={() => handleModeSelect('clone')}
              className="w-full p-4 rounded-xl bg-card border border-border/50 hover:border-primary/50 transition-all text-left flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                <Mic className="w-6 h-6 text-accent-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">Use My Voice</p>
                <p className="text-sm text-muted-foreground">Clone your own voice</p>
              </div>
            </button>

            <button
              onClick={() => handleModeSelect('premium')}
              className="w-full p-4 rounded-xl bg-card border border-border/50 hover:border-primary/50 transition-all text-left flex items-center gap-4 opacity-60"
            >
              <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-yellow-500" />
              </div>
              <div>
                <p className="font-medium text-foreground">Premium Voices</p>
                <p className="text-sm text-muted-foreground">Studio quality (Ozlon Pro)</p>
              </div>
            </button>
          </div>
        )}

        {/* Standard Voice Selection */}
        {selectedMode === 'standard' && (
          <div className="w-full">
            <p className="text-sm text-muted-foreground mb-4 text-center">
              Tap a voice to preview
            </p>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {standardVoices.map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => handleVoiceSelect(voice.id)}
                  className={`p-4 rounded-xl border transition-all ${
                    selectedVoice === voice.id
                      ? 'bg-primary/10 border-primary'
                      : 'bg-card border-border/50 hover:border-primary/30'
                  }`}
                >
                  <p className="font-medium text-foreground">{voice.name}</p>
                  <p className="text-xs text-muted-foreground">{voice.description}</p>
                </button>
              ))}
            </div>
            <Button onClick={handleContinue} className="w-full" disabled={!selectedVoice}>
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}

        {/* Voice Cloning */}
        {selectedMode === 'clone' && !isComplete && (
          <div className="w-full text-center">
            {!isRecording && !isProcessing && (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Read the following sentence aloud for 15 seconds:
                </p>
                <div className="p-4 rounded-xl bg-card border border-border/50 mb-6">
                  <p className="text-foreground italic">
                    "{SAMPLE_SENTENCES[0]}"
                  </p>
                </div>
                <Button onClick={handleRecordVoice} className="w-full">
                  <Mic className="w-4 h-4 mr-2" />
                  Start Recording
                </Button>
              </>
            )}

            {isRecording && (
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
                  <Mic className="w-10 h-10 text-red-500" />
                </div>
                <p className="text-foreground">Recording...</p>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${recordingProgress}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {SAMPLE_SENTENCES[0]}
                </p>
              </div>
            )}

            {isProcessing && (
              <div className="space-y-4">
                <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin" />
                <p className="text-foreground">Creating your voice...</p>
                <p className="text-sm text-muted-foreground">
                  This may take a moment
                </p>
              </div>
            )}
          </div>
        )}

        {/* Voice Cloning Complete */}
        {selectedMode === 'clone' && isComplete && (
          <div className="w-full text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center mb-4">
              <Check className="w-10 h-10 text-green-500" />
            </div>
            <p className="text-foreground font-medium mb-2">Voice Ready</p>
            <p className="text-sm text-muted-foreground mb-6">
              Ozlon will now respond using your voice
            </p>
            <Button onClick={handleContinue} className="w-full">
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}

        {/* Premium Upsell */}
        {selectedMode === 'premium' && (
          <div className="w-full text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-yellow-500/10 flex items-center justify-center mb-4">
              <Sparkles className="w-10 h-10 text-yellow-500" />
            </div>
            <p className="text-foreground font-medium mb-2">Premium Feature</p>
            <p className="text-sm text-muted-foreground mb-6">
              Studio-quality voices are available with Ozlon Pro. Upgrade to unlock premium voices.
            </p>
            <div className="space-y-3">
              <Button variant="outline" className="w-full" onClick={() => setSelectedMode(null)}>
                Choose Standard Voice
              </Button>
              <Button onClick={handleContinue} className="w-full">
                Continue with Default
              </Button>
            </div>
          </div>
        )}

        {/* Skip Option */}
        {!isRecording && !isProcessing && (
          <button
            onClick={handleSkip}
            className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
