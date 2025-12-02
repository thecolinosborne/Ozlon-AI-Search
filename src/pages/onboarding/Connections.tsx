import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Calendar, Mail, CreditCard } from "lucide-react";
import { api } from "@/services/api";

const OptionalConnections = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const connections = [
    {
      type: "calendar",
      icon: Calendar,
      label: "Calendar",
    },
    {
      type: "email",
      icon: Mail,
      label: "Email",
    },
    {
      type: "banking",
      icon: CreditCard,
      label: "Banking",
    },
  ];

  const handleConnection = async (type: string) => {
    setLoading(true);
    
    if (type === "skip") {
      setLoading(false);
      navigate("/onboarding/first-analysis");
      return;
    }

    await api.onboarding.connect(type);
    setLoading(false);
    navigate("/onboarding/first-analysis");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-medium text-foreground leading-relaxed">
            Optional Connections
          </h1>
          <p className="text-base text-muted-foreground">
            You may connect additional systems to expand the Orb's analytical range. Nothing is accessed or altered without your explicit direction.
          </p>
        </div>

        <div className="space-y-3">
          {connections.map((connection) => {
            const Icon = connection.icon;
            
            return (
              <button
                key={connection.type}
                onClick={() => handleConnection(connection.type)}
                disabled={loading}
                className="w-full bg-secondary/50 backdrop-blur-sm rounded-2xl border border-border/50 p-6 hover:border-primary/50 transition-all text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <span className="text-lg text-foreground">{connection.label}</span>
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => handleConnection("skip")}
          disabled={loading}
          className="w-full text-muted-foreground text-base hover:text-foreground transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
};

export default OptionalConnections;
