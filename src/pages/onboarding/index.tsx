import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingVoice } from "@/hooks/useOnboardingVoice";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { WelcomeScreen } from "@/components/onboarding/screens/WelcomeScreen";
import { PersonalSnapshotScreen } from "@/components/onboarding/screens/PersonalSnapshotScreen";
import { DailyRhythmScreen } from "@/components/onboarding/screens/DailyRhythmScreen";
import { CommunicationStyleScreen } from "@/components/onboarding/screens/CommunicationStyleScreen";
import { PrimaryNeedScreen } from "@/components/onboarding/screens/PrimaryNeedScreen";
import { ProactivityScreen } from "@/components/onboarding/screens/ProactivityScreen";
import { InteractionPreferenceScreen } from "@/components/onboarding/screens/InteractionPreferenceScreen";
import { CompletionScreen } from "@/components/onboarding/screens/CompletionScreen";
import type { UserProfile } from "@/types";

type Step = 
  | "welcome"
  | "personal"
  | "rhythm"
  | "communication"
  | "need"
  | "proactivity"
  | "interaction"
  | "complete";

const steps: Step[] = [
  "welcome",
  "personal",
  "rhythm",
  "communication",
  "need",
  "proactivity",
  "interaction",
  "complete",
];

const Onboarding = () => {
  const navigate = useNavigate();
  const { updateUser } = useAppStore();
  const { completeOnboarding } = useAuth();
  const { isSpeaking, speakForStep, stopSpeaking } = useOnboardingVoice({ enabled: true });
  
  // Profile state
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [profile, setProfile] = useState<UserProfile>({
    name: "",
    personalNotes: null,
    wakeTime: null,
    morningEnergy: null,
    responseLengthPreference: "medium",
    tonePreference: "neutral",
    primaryNeed: null,
    proactivityPreference: "judgment",
    interactionPreference: "both",
  });

  const stepIndex = steps.indexOf(currentStep);
  const progress = ((stepIndex) / (steps.length - 1)) * 100;

  // Trigger voice narration when step changes
  useEffect(() => {
    speakForStep(currentStep);
  }, [currentStep, speakForStep]);

  const nextStep = () => {
    stopSpeaking(); // Stop current narration when moving to next step
    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const updateProfile = (updates: Partial<UserProfile>) => {
    setProfile(prev => ({ ...prev, ...updates }));
  };

  const handleComplete = async () => {
    // Map new profile to existing user structure
    const communicationMode = profile.interactionPreference === "typing" 
      ? "text" as const
      : profile.interactionPreference === "talking" 
        ? "voice" as const 
        : "both" as const;

    const insightStyle = profile.responseLengthPreference === "short"
      ? "direct" as const
      : profile.responseLengthPreference === "detailed"
        ? "detailed" as const
        : "adaptive" as const;

    // Update app store
    updateUser({
      name: profile.name,
      orbName: "Ozlon",
      communicationMode,
      insightStyle,
      personalNotes: profile.personalNotes || undefined,
      wakeTime: profile.wakeTime || undefined,
      morningEnergy: profile.morningEnergy || undefined,
      responseLengthPreference: profile.responseLengthPreference,
      tonePreference: profile.tonePreference,
      primaryNeed: profile.primaryNeed || undefined,
      proactivityPreference: profile.proactivityPreference,
      onboardingComplete: true,
    });

    // Save to localStorage for persistence
    localStorage.setItem("ozlon_user_name", profile.name);
    localStorage.setItem("ozlon_onboarded", "true");
    localStorage.setItem("ozlon_profile", JSON.stringify(profile));

    // Complete onboarding in auth context
    await completeOnboarding("Ozlon");

    // Navigate to chat, enable voice mode if preferred
    navigate("/");
  };

  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <WelcomeScreen
            name={profile.name}
            onNameChange={(name) => updateProfile({ name })}
            onContinue={nextStep}
            isSpeaking={isSpeaking}
          />
        );

      case "personal":
        return (
          <PersonalSnapshotScreen
            name={profile.name}
            personalNotes={profile.personalNotes || ""}
            onNotesChange={(personalNotes) => updateProfile({ personalNotes })}
            onContinue={nextStep}
            onSkip={nextStep}
            isSpeaking={isSpeaking}
          />
        );

      case "rhythm":
        return (
          <DailyRhythmScreen
            wakeTime={profile.wakeTime || ""}
            morningEnergy={profile.morningEnergy}
            onWakeTimeChange={(wakeTime) => updateProfile({ wakeTime })}
            onMorningEnergyChange={(morningEnergy) => updateProfile({ morningEnergy })}
            onContinue={nextStep}
          />
        );

      case "communication":
        return (
          <CommunicationStyleScreen
            responseLengthPreference={profile.responseLengthPreference}
            tonePreference={profile.tonePreference}
            onResponseLengthChange={(responseLengthPreference) => updateProfile({ responseLengthPreference })}
            onToneChange={(tonePreference) => updateProfile({ tonePreference })}
            onContinue={nextStep}
          />
        );

      case "need":
        return (
          <PrimaryNeedScreen
            primaryNeed={profile.primaryNeed || ""}
            onNeedChange={(primaryNeed) => updateProfile({ primaryNeed })}
            onContinue={nextStep}
          />
        );

      case "proactivity":
        return (
          <ProactivityScreen
            proactivityPreference={profile.proactivityPreference}
            onProactivityChange={(proactivityPreference) => updateProfile({ proactivityPreference })}
            onContinue={nextStep}
          />
        );

      case "interaction":
        return (
          <InteractionPreferenceScreen
            interactionPreference={profile.interactionPreference}
            onInteractionChange={(interactionPreference) => updateProfile({ interactionPreference })}
            onContinue={nextStep}
          />
        );

      case "complete":
        return (
          <CompletionScreen
            name={profile.name}
            interactionPreference={profile.interactionPreference}
            onComplete={handleComplete}
            isSpeaking={isSpeaking}
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
