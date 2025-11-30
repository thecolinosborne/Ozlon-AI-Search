import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";

const Final = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const userName = localStorage.getItem("userName") || "there";

  const handleStart = async () => {
    setLoading(true);
    await api.onboarding.complete();
    setLoading(false);
    navigate("/chat");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8 text-center">
        <h1 className="text-3xl font-medium text-foreground leading-relaxed">
          You're all set, {userName}. Whenever you need anything — just talk to me.
        </h1>
        
        <Button
          onClick={handleStart}
          disabled={loading}
          className="w-full h-14 text-lg rounded-2xl"
          size="lg"
        >
          Start using Ozlon
        </Button>
      </div>
    </div>
  );
};

export default Final;
