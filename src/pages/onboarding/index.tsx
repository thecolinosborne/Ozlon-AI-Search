import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingVoice } from "@/hooks/useOnboardingVoice";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { WelcomeScreen } from "@/components/onboarding/screens/WelcomeScreen";
import { PreferencesScreen } from "@/components/onboarding/screens/PreferencesScreen";
import { CompletionScreen } from "@/components/onboarding/screens/CompletionScreen";

type Step = "welcome" | "preferences" | "complete";

const steps: Step[] = ["welcome", "preferences", "complete"];

const Onboarding = () => {
  const navigate = useNavigate();
  const { updateUser } = useAppStore();
  const { completeOnboarding } = useAuth();
  const { isSpeaking, speakForStep, replayCurrentStep, stopSpeaking } = useOnboardingVoice({ enabled: true });

  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [responseLengthPreference, setResponseLengthPreference] = useState<"short" | "medium" | "detailed">("medium");
  const [tonePreference, setTonePreference] = useState<"casual" | "neutral" | "polished">("neutral");
  const [interactionPreference, setInteractionPreference] = useState<"typing" | "talking" | "both">("both");

  const stepIndex = steps.indexOf(currentStep);
  const progress = (stepIndex / (steps.length - 1)) * 100;

  useEffect(() => {
    speakForStep(currentStep, name);
  }, [currentStep, speakForStep, name]);

  const handleReplay = useCallback(() => {
    replayCurrentStep(currentStep, name);
  }, [replayCurrentStep, currentStep, name]);

  const handleSkipAudio = useCallback(() => {
    stopSpeaking();
  }, [stopSpeaking]);

  const nextStep = () => {
    stopSpeaking();
    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const handleComplete = async () => {
    stopSpeaking();

    const communicationMode = interactionPreference === "typing"
      ? "text" as const
      : interactionPreference === "talking"
        ? "voice" as const
        : "both" as const;

    const insightStyle = responseLengthPreference === "short"
      ? "direct" as const
      : responseLengthPreference === "detailed"
        ? "detailed" as const
        : "adaptive" as const;

    updateUser({
      name,
      orbName: "Ozlon",
      communicationMode,
      insightStyle,
      responseLengthPreference,
      tonePreference,
      onboardingComplete: true,
    });

    localStorage.setItem("ozlon_user_name", name);
    localStorage.setItem("ozlon_onboarded", "true");

    await completeOnboarding("Ozlon");
    navigate("/");
  };

  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <WelcomeScreen
            name={name}
            onNameChange={setName}
            onContinue={nextStep}
            isSpeaking={isSpeaking}
            onReplay={handleReplay}
            onSkipAudio={handleSkipAudio}
          />
        );

      case "preferences":
        return (
          <PreferencesScreen
            responseLengthPreference={responseLengthPreference}
            tonePreference={tonePreference}
            interactionPreference={interactionPreference}
            onResponseLengthChange={setResponseLengthPreference}
            onToneChange={setTonePreference}
            onInteractionChange={setInteractionPreference}
            onContinue={nextStep}
            isSpeaking={isSpeaking}
            onReplay={handleReplay}
            onSkipAudio={handleSkipAudio}
          />
        );

      case "complete":
        return (
          <CompletionScreen
            name={name}
            interactionPreference={interactionPreference}
            onComplete={handleComplete}
            isSpeaking={isSpeaking}
            onReplay={handleReplay}
            onSkipAudio={handleSkipAudio}
          />
        );

      default:
        return null;
    }
  };

  const showProgress = currentStep !== "welcome" && currentStep !== "complete";

  return (
    <OnboardingLayout
      showProgress={showProgress}
      progress={progress}
      step={stepIndex}
      totalSteps={steps.length - 2}
    >
      {renderStep()}
    </OnboardingLayout>
  );
};

export default Onboarding;
