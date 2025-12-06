import { useCallback, useRef, useEffect, useState } from 'react';
import { voiceService, OZLON_DEFAULT_VOICE_ID } from '@/services/voiceService';

// Get narration script for a step, with optional name personalization
const getNarrationScript = (step: string, name?: string): string => {
  const scripts: Record<string, string | ((n: string) => string)> = {
    welcome: "Hey, I'm Ozlon. I'm here for you. What should I call you?",
    personal: (n: string) => `Thanks, ${n}. Is there anything important about you or your life that I should keep in mind? You can share as much or as little as you'd like.`,
    rhythm: "Let's match your natural flow. What time do your days usually begin? And do your mornings feel calm, busy, or somewhere in the middle?",
    communication: "How should I talk with you? Do you prefer short answers, medium, or detailed? And is your usual tone more casual, neutral, or polished?",
    need: "If I could make one thing easier for you right now, what would it be?",
    proactivity: "When I notice something helpful, should I tell you right away, wait until you ask, or use my judgment?",
    interaction: "How do you prefer to talk with me? Typing, talking, or both?",
    complete: (n: string) => `Perfect, ${n}. I'll take everything you've shared and start helping you. Tap Start Chatting to begin.`,
  };

  const script = scripts[step];
  if (!script) return '';
  
  if (typeof script === 'function') {
    return script(name || 'there');
  }
  return script;
};

interface UseOnboardingVoiceOptions {
  enabled?: boolean;
}

export function useOnboardingVoice({ enabled = true }: UseOnboardingVoiceOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const hasSpokenRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  const currentNameRef = useRef<string>('');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      voiceService.stop();
    };
  }, []);

  const speakForStep = useCallback(async (step: string, name?: string) => {
    if (!enabled) return;
    
    // Update name ref for replay functionality
    if (name) {
      currentNameRef.current = name;
    }
    
    // Don't repeat narration for the same step
    if (hasSpokenRef.current.has(step)) return;
    
    const script = getNarrationScript(step, name || currentNameRef.current);
    if (!script) return;

    // Stop any current speech
    voiceService.stop();
    
    hasSpokenRef.current.add(step);
    setCurrentStep(step);
    setIsSpeaking(true);

    try {
      console.log(`[Onboarding Voice] Speaking for step: ${step}`);
      await voiceService.speak(script, OZLON_DEFAULT_VOICE_ID);
    } catch (error) {
      console.error('[Onboarding Voice] Failed to speak:', error);
    } finally {
      if (isMountedRef.current) {
        setIsSpeaking(false);
        setCurrentStep(null);
      }
    }
  }, [enabled]);

  const replayCurrentStep = useCallback(async (step: string, name?: string) => {
    if (!enabled) return;
    
    const script = getNarrationScript(step, name || currentNameRef.current);
    if (!script) return;

    // Stop any current speech
    voiceService.stop();
    
    setCurrentStep(step);
    setIsSpeaking(true);

    try {
      console.log(`[Onboarding Voice] Replaying for step: ${step}`);
      await voiceService.speak(script, OZLON_DEFAULT_VOICE_ID);
    } catch (error) {
      console.error('[Onboarding Voice] Failed to replay:', error);
    } finally {
      if (isMountedRef.current) {
        setIsSpeaking(false);
        setCurrentStep(null);
      }
    }
  }, [enabled]);

  const stopSpeaking = useCallback(() => {
    voiceService.stop();
    setIsSpeaking(false);
    setCurrentStep(null);
  }, []);

  const resetSpokenSteps = useCallback(() => {
    hasSpokenRef.current.clear();
  }, []);

  const allowReplayForStep = useCallback((step: string) => {
    hasSpokenRef.current.delete(step);
  }, []);

  return {
    isSpeaking,
    currentStep,
    speakForStep,
    replayCurrentStep,
    stopSpeaking,
    resetSpokenSteps,
    allowReplayForStep,
  };
}
