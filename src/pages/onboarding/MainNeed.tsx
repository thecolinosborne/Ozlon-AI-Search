import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/services/api";

const needs = ["Money", "Food", "Work", "Stress", "Something else"];

const MainNeed = () => {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSelect = async (need: string) => {
    setSelected(need);
    setLoading(true);
    await api.onboarding.setMainConcern(need);
    setLoading(false);
    navigate("/onboarding/insight");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
          Everyone has something going on.<br />
          What's on your mind today?
        </h1>
        
        <div className="grid grid-cols-2 gap-4 pt-8">
          {needs.map((need) => (
            <button
              key={need}
              onClick={() => !loading && handleSelect(need)}
              className={`p-8 rounded-2xl text-xl font-medium transition-all duration-200 backdrop-blur-sm border ${
                selected === need
                  ? "bg-primary/20 border-primary text-foreground"
                  : "bg-secondary/30 border-border/50 text-foreground hover:bg-secondary/50"
              }`}
            >
              {need}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MainNeed;
