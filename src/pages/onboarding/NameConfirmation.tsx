import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const NameConfirmation = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const userName = localStorage.getItem("userName") || "there";
  const assistantName = localStorage.getItem("assistantName") || "Assistant";

  const handleContinue = async () => {
    setLoading(true);
    await api.onboarding.nameConfirmed();
    setLoading(false);
    navigate("/onboarding/location");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-4">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Nice to meet you, {userName}.
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            I'll go by {assistantName} from now on.
          </p>
        </div>
        
        <Button
          onClick={handleContinue}
          disabled={loading}
          className="w-full h-14 text-lg rounded-2xl"
          size="lg"
        >
          Continue
        </Button>
      </div>
    </div>
  );
};

export default NameConfirmation;
