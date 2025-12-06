import { useCallback, useRef, useEffect, useState } from 'react';
import { voiceService, OZLON_DEFAULT_VOICE_ID } from '@/services/voiceService';

// Onboarding narration scripts for each step
const NARRATION_SCRIPTS: Record<string, string> = {
  welcome: "Hey, I'm Ozlon. I'm here for you. Before we get started, what should I call you?",
  personal: "Is there anything important about you or your life that I should keep in mind? You can share as much or as little as you'd like.",
  rhythm: "Let's talk about your daily rhythm. When do you usually wake up, and how do your mornings feel?",
  communication: "How would you like me to communicate with you? I can be brief and direct, or more detailed and thorough.",
  need: "What matters most to you right now? Whether it's time, money, health, or something else entirely.",
  proactivity: "Should I proactively reach out with suggestions, or wait until you ask?",
  interaction: "Would you prefer typing, talking, or both when we communicate?",
  complete: "Perfect. I'll use everything you shared to make things easier for you starting now.",
};

interface UseOnboardingVoiceOptions {
  enabled?: boolean;
}

export function useOnboardingVoice({ enabled = true }: UseOnboardingVoiceOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const hasSpokenRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      voiceService.stop();
    };
  }, []);

  const speakForStep = useCallback(async (step: string) => {
    if (!enabled) return;
    
    // Don't repeat narration for the same step
    if (hasSpokenRef.current.has(step)) return;
    
    const script = NARRATION_SCRIPTS[step];
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

  const stopSpeaking = useCallback(() => {
    voiceService.stop();
    setIsSpeaking(false);
    setCurrentStep(null);
  }, []);

  const resetSpokenSteps = useCallback(() => {
    hasSpokenRef.current.clear();
  }, []);

  return {
    isSpeaking,
    currentStep,
    speakForStep,
    stopSpeaking,
    resetSpokenSteps,
  };
}
