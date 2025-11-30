import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";
import { api } from "@/services/api";

const ConnectService = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    await api.onboarding.connect("bank");
    setLoading(false);
    navigate("/onboarding/insight");
  };

  const handleLater = () => {
    navigate("/onboarding/insight");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <Link2 className="w-16 h-16 text-primary mx-auto" />
          <h1 className="text-3xl font-medium text-foreground">
            Connect your bank
          </h1>
          <p className="text-lg text-muted-foreground">
            This helps me track spending and give you summaries.
          </p>
        </div>
        
        <div className="space-y-4">
          <Button
            onClick={handleConnect}
            disabled={loading}
            className="w-full h-14 text-lg rounded-2xl"
            size="lg"
          >
            Connect Bank
          </Button>
          
          <button
            onClick={handleLater}
            className="w-full text-primary text-base font-medium hover:underline"
          >
            Do this later
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectService;
