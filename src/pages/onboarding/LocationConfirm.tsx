import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
import { api } from "@/services/api";

const LocationConfirm = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const userName = localStorage.getItem("userName") || "there";
  const [location] = useState("San Francisco, CA");

  const handleConfirm = async () => {
    setLoading(true);
    await api.onboarding.setLocation(location);
    setLoading(false);
    navigate("/onboarding/main-need");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
          Where are you living these days?
        </h1>
        
        <div className="bg-secondary rounded-3xl p-8 flex flex-col items-center space-y-4">
          <MapPin className="w-12 h-12 text-primary" />
          <p className="text-xl font-medium text-foreground">{location}</p>
          <p className="text-sm text-muted-foreground">Auto-detected location</p>
        </div>
        
        <div className="space-y-4">
          <Button
            onClick={handleConfirm}
            disabled={loading}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Yes, that's it
          </Button>
          
          <button
            onClick={() => {}}
            className="w-full text-primary text-base underline-offset-4 hover:underline"
          >
            Change location
          </button>
        </div>
      </div>
    </div>
  );
};

export default LocationConfirm;
