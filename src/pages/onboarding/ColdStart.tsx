import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { useState } from "react";

const ColdStart = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    await api.onboarding.start();
    setLoading(false);
    navigate("/onboarding/name");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in relative overflow-hidden">
      {/* Faint flowing lines background */}
      <div className="absolute inset-0 opacity-5">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <path d="M0,100 Q250,50 500,100 T1000,100" stroke="currentColor" strokeWidth="2" fill="none" className="text-primary" />
          <path d="M0,200 Q250,150 500,200 T1000,200" stroke="currentColor" strokeWidth="2" fill="none" className="text-primary" />
          <path d="M0,300 Q250,250 500,300 T1000,300" stroke="currentColor" strokeWidth="2" fill="none" className="text-primary" />
        </svg>
      </div>
      
      <div className="max-w-md w-full space-y-8 text-center relative z-10">
        <h1 className="text-3xl font-medium text-foreground leading-relaxed">
          Hi, I'm Ozlon.<br />
          I'm here to make your life easier.<br />
          Can I get to know you a little?
        </h1>
        
        <div className="space-y-4 pt-8">
          <Button
            onClick={handleStart}
            disabled={loading}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Yes, that's fine
          </Button>
          
          <Button
            onClick={() => navigate("/chat")}
            variant="ghost"
            className="w-full h-14 text-lg rounded-2xl text-muted-foreground"
            size="lg"
          >
            Maybe later
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ColdStart;
