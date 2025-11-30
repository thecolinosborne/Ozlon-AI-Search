import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, UtensilsCrossed, Briefcase, Heart } from "lucide-react";
import { CategoryTile } from "@/components/CategoryTile";
import { api } from "@/services/api";

const FocusArea = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleFocus = async (focus: string) => {
    setLoading(true);
    await api.onboarding.setFocus(focus);
    setLoading(false);
    navigate("/onboarding/connections");
  };

  const focusAreas = [
    { icon: Wallet, title: "Money & Bills" },
    { icon: UtensilsCrossed, title: "Food & Daily Stuff" },
    { icon: Briefcase, title: "Work & Goals" },
    { icon: Heart, title: "Stress & Help" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
          I can help with a few parts of your life.<br />
          What should we start with?
        </h1>

        <div className="grid grid-cols-2 gap-4 pt-8">
          {focusAreas.map((area) => (
            <CategoryTile
              key={area.title}
              icon={area.icon}
              title={area.title}
              onClick={() => !loading && handleFocus(area.title)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default FocusArea;
