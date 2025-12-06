import { Button } from "@/components/ui/button";
import { OnboardingOption } from "../OnboardingOption";
import { OnboardingVoiceButton } from "../OnboardingVoiceButton";

interface DailyRhythmScreenProps {
  wakeTime: string;
  morningEnergy: "calm" | "busy" | "mixed" | null;
  onWakeTimeChange: (time: string) => void;
  onMorningEnergyChange: (energy: "calm" | "busy" | "mixed") => void;
  onContinue: () => void;
}

export const DailyRhythmScreen = ({
  wakeTime,
  morningEnergy,
  onWakeTimeChange,
  onMorningEnergyChange,
  onContinue,
}: DailyRhythmScreenProps) => {
  const handleVoiceInput = (text: string) => {
    // Try to extract time from voice input
    const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] || "00";
      const meridiem = timeMatch[3]?.toLowerCase();
      
      if (meridiem === "pm" && hours < 12) hours += 12;
      if (meridiem === "am" && hours === 12) hours = 0;
      
      onWakeTimeChange(`${hours.toString().padStart(2, "0")}:${minutes}`);
    } else {
      onWakeTimeChange(text);
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-semibold text-foreground mb-3 tracking-tight">
        Let's match your natural flow.
      </h1>
      <p className="text-muted-foreground mb-8 text-lg">
        What time do your days usually begin?
      </p>
      
      <div className="flex items-center gap-3 mb-10">
        <input
          type="time"
          value={wakeTime}
          onChange={(e) => onWakeTimeChange(e.target.value)}
          className="flex-1 h-14 px-5 rounded-2xl bg-card/60 border border-border/40 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all text-lg"
        />
        <OnboardingVoiceButton onVoiceInput={handleVoiceInput} />
      </div>
      
      <p className="text-muted-foreground mb-4 text-lg">
        Do your mornings feel...
      </p>
      
      <div className="space-y-3 mb-8">
        <OnboardingOption
          label="Calm"
          description="Steady and unhurried"
          selected={morningEnergy === "calm"}
          onClick={() => onMorningEnergyChange("calm")}
        />
        <OnboardingOption
          label="Busy"
          description="Fast-paced and active"
          selected={morningEnergy === "busy"}
          onClick={() => onMorningEnergyChange("busy")}
        />
        <OnboardingOption
          label="Somewhere in the middle"
          description="Varies day to day"
          selected={morningEnergy === "mixed"}
          onClick={() => onMorningEnergyChange("mixed")}
        />
      </div>
      
      <Button
        onClick={onContinue}
        disabled={!morningEnergy}
        className="w-full h-14 rounded-2xl text-lg font-medium transition-all duration-300 hover:scale-[1.02]"
      >
        Continue
      </Button>
    </div>
  );
};
