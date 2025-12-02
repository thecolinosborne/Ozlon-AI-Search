import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AIOrb } from "@/components/AIOrb";

const OrbOrientation = () => {
  const navigate = useNavigate();

  const handleProceed = () => {
    navigate("/onboarding/daily-structure");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="scale-[3] opacity-20">
          <AIOrb breatheIn={true} />
        </div>
      </div>

      <div className="max-w-md w-full space-y-8 text-center relative z-10">
        <h1 className="text-3xl font-medium text-foreground leading-relaxed">
          Operational Overview
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          The Orb will ask a sequence of structured questions. Your choices allow it to build an internal model of your patterns, priorities, and tendencies. Insights will appear as the model develops.
        </p>

        <div className="pt-8">
          <Button
            onClick={handleProceed}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Proceed
          </Button>
        </div>
      </div>
    </div>
  );
};

export default OrbOrientation;
