import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AIOrb } from "@/components/AIOrb";

const FirstAnalysis = () => {
  const navigate = useNavigate();
  const [lines, setLines] = useState<string[]>([]);

  const analysisLines = [
    "Your daily model has been established.",
    "Your priority domains have been indexed.",
    "Your communication style has been configured.",
    "The Orb is now ready to observe, analyze, and respond.",
  ];

  useEffect(() => {
    analysisLines.forEach((line, index) => {
      setTimeout(() => {
        setLines(prev => [...prev, line]);
      }, index * 1000);
    });
  }, []);

  const handleEnter = () => {
    navigate("/chat");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="scale-[2.5] opacity-30">
          <AIOrb breatheIn={true} />
        </div>
      </div>

      <div className="max-w-md w-full space-y-8 text-center relative z-10">
        <h1 className="text-3xl font-medium text-foreground leading-relaxed">
          Initial Analysis Complete
        </h1>

        <div className="space-y-4">
          {lines.map((line, index) => (
            <p
              key={index}
              className="text-lg text-muted-foreground leading-relaxed animate-fade-in"
            >
              {line}
            </p>
          ))}
        </div>

        {lines.length === analysisLines.length && (
          <div className="pt-8 animate-fade-in">
            <Button
              onClick={handleEnter}
              className="w-full h-14 text-lg rounded-2xl"
              size="lg"
            >
              Enter the Orb
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FirstAnalysis;
