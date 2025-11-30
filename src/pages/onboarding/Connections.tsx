import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/services/api";
import { CreditCard, Mail, Calendar } from "lucide-react";

const Connections = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const connections = [
    {
      type: "bank",
      label: "Bank",
      description: "So I can help with money and bills.",
      icon: CreditCard,
    },
    {
      type: "email",
      label: "Email",
      description: "So I can find important things you might have missed.",
      icon: Mail,
    },
    {
      type: "calendar",
      label: "Calendar",
      description: "So I can keep you on track.",
      icon: Calendar,
    },
  ];

  const handleConnection = async (type: string) => {
    if (type === "skip") {
      navigate("/onboarding/main-need");
      return;
    }
    setLoading(true);
    await api.onboarding.connect(type);
    setLoading(false);
    navigate("/onboarding/main-need");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <div className="space-y-4">
          <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
            I can help you much better if I understand the things going on in your life.
          </h1>
          <p className="text-base text-muted-foreground text-center">
            If you want, you can connect a few apps you already use, and I'll learn from them to support you.<br />
            You're always in control.
          </p>
        </div>

        <div className="space-y-3 pt-4">
          {connections.map((connection) => {
            const Icon = connection.icon;
            return (
              <button
                key={connection.type}
                onClick={() => !loading && handleConnection(connection.type)}
                className="w-full p-6 bg-secondary/30 backdrop-blur-sm rounded-2xl text-left hover:bg-secondary/50 transition-all duration-200 border border-border/50 group"
              >
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-foreground mb-1">
                      {connection.label}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {connection.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
          
          <button
            onClick={() => !loading && handleConnection("skip")}
            className="w-full p-6 text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
};

export default Connections;
