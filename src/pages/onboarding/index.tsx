import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingVoice } from "@/hooks/useOnboardingVoice";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { WelcomeScreen } from "@/components/onboarding/screens/WelcomeScreen";
import { NamingScreen } from "@/components/onboarding/screens/NamingScreen";
import { CompletionScreen } from "@/components/onboarding/screens/CompletionScreen";
import { supabase } from "@/integrations/supabase/client";

type Step = "welcome" | "naming" | "complete";

const steps: Step[] = ["welcome", "naming", "complete"];

const Onboarding = () => {
  const navigate = useNavigate();
  const { updateUser } = useAppStore();
  const { completeOnboarding, user } = useAuth();
  const { isSpeaking, speakForStep, replayCurrentStep, stopSpeaking } = useOnboardingVoice({ enabled: true });

  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [systemName, setSystemName] = useState("Ozlon");

  const stepIndex = steps.indexOf(currentStep);
  const progress = (stepIndex / (steps.length - 1)) * 100;

  // Pre-fill email from auth user
  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
    // Pre-fill name from user metadata if available
    const meta = user?.user_metadata;
    if (meta?.full_name) {
      const parts = meta.full_name.split(" ");
      if (parts.length >= 2) {
        setFirstName(parts[0]);
        setLastName(parts.slice(1).join(" "));
      } else {
        setFirstName(parts[0] || "");
      }
    }
  }, [user]);

  useEffect(() => {
    speakForStep(currentStep, firstName);
  }, [currentStep, speakForStep, firstName]);

  const handleReplay = useCallback(() => {
    replayCurrentStep(currentStep, firstName);
  }, [replayCurrentStep, currentStep, firstName]);

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

    const finalSystemName = systemName.trim() || "Ozlon";
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

    // Save to profile
    if (user) {
      try {
        await supabase
          .from("profiles")
          .update({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: fullName,
            system_name: finalSystemName,
            onboarding_complete: true,
          })
          .eq("user_id", user.id);
      } catch (error) {
        console.error("Error saving onboarding profile:", error);
      }
    }

    updateUser({
      name: fullName,
      orbName: finalSystemName,
      onboardingComplete: true,
    });

    localStorage.setItem("ozlon_user_name", fullName);
    localStorage.setItem("ozlon_onboarded", "true");

    await completeOnboarding(finalSystemName);
    navigate("/");
  };

  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <WelcomeScreen
            firstName={firstName}
            lastName={lastName}
            email={email}
            onFirstNameChange={setFirstName}
            onLastNameChange={setLastName}
            onContinue={nextStep}
            isSpeaking={isSpeaking}
            onReplay={handleReplay}
            onSkipAudio={handleSkipAudio}
          />
        );

      case "naming":
        return (
          <NamingScreen
            systemName={systemName}
            onSystemNameChange={setSystemName}
            onContinue={nextStep}
            isSpeaking={isSpeaking}
            onReplay={handleReplay}
            onSkipAudio={handleSkipAudio}
          />
        );

      case "complete":
        return (
          <CompletionScreen
            firstName={firstName}
            systemName={systemName}
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