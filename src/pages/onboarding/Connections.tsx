import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/services/api";
import { CreditCard, Mail, Calendar, ChevronDown, ChevronUp } from "lucide-react";

const Connections = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const connections = [
    {
      type: "bank",
      label: "Bank",
      description: "So I can help with money and bills.",
      expandedText: "I can look at your spending and bills to help you stay ahead. I'll never move money without asking you.",
      icon: CreditCard,
    },
    {
      type: "email",
      label: "Email",
      description: "So I can find important things you might have missed.",
      expandedText: "I can surface critical emails like bills or reminders. I won't send anything without your okay.",
      icon: Mail,
    },
    {
      type: "calendar",
      label: "Calendar",
      description: "So I can keep you on track.",
      expandedText: "I can remind you about appointments and deadlines. I won't add anything without your permission.",
      icon: Calendar,
    },
  ];

  const handleConnection = async (type: string) => {
    if (type === "skip") {
      localStorage.setItem("connectedApps", "none");
      navigate("/onboarding/insight");
      return;
    }
    setLoading(true);
    await api.onboarding.connect(type);
    localStorage.setItem("connectedApps", type);
    setLoading(false);
    navigate("/onboarding/insight");
  };

  const toggleExpand = (type: string) => {
    setExpandedCard(expandedCard === type ? null : type);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <div className="space-y-4">
          <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
            Help me understand your world
          </h1>
          <p className="text-base text-muted-foreground text-center leading-relaxed">
            I can help you better if I know what your life looks like.
            If you want, you can connect a few apps you already use, and I'll learn from them to support you.
            <br />
            <span className="text-foreground/80 font-medium">You're always in control.</span>
          </p>
        </div>

        <div className="space-y-3 pt-4">
          {connections.map((connection) => {
            const Icon = connection.icon;
            const isExpanded = expandedCard === connection.type;
            
            return (
              <div
                key={connection.type}
                className="bg-secondary/30 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden transition-all duration-300"
              >
                <button
                  onClick={() => toggleExpand(connection.type)}
                  className="w-full p-6 text-left hover:bg-secondary/50 transition-all duration-200 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4 flex-1">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors flex-shrink-0">
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
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-2" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-2" />
                    )}
                  </div>
                </button>
                
                {isExpanded && (
                  <div className="px-6 pb-6 animate-fade-in">
                    <div className="pl-16 space-y-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {connection.expandedText}
                      </p>
                      <button
                        onClick={() => !loading && handleConnection(connection.type)}
                        disabled={loading}
                        className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-medium hover:bg-primary/90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                      >
                        Connect {connection.label}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={() => !loading && handleConnection("skip")}
            className="w-full p-6 text-muted-foreground hover:text-foreground transition-colors text-center"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
};

export default Connections;
