import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CategoryTile } from "@/components/CategoryTile";
import { DollarSign, UtensilsCrossed, Briefcase, Home } from "lucide-react";
import { api } from "@/services/api";

const categories = [
  { icon: DollarSign, title: "Money" },
  { icon: UtensilsCrossed, title: "Food" },
  { icon: Briefcase, title: "Work" },
  { icon: Home, title: "Daily Life" },
];

const Categories = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleSelect = async (category: string) => {
    setLoading(true);
    await api.onboarding.setCategory(category);
    setLoading(false);
    navigate("/onboarding/final");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
          I can help with a few parts of your life. Where would you like to start?
        </h1>
        
        <div className="grid grid-cols-2 gap-4">
          {categories.map((category) => (
            <CategoryTile
              key={category.title}
              icon={category.icon}
              title={category.title}
              onClick={() => !loading && handleSelect(category.title)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Categories;
