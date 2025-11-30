import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/services/api";

const Connections = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const connections = ["Your bank", "Your email", "Your calendar", "Skip for now"];

  const handleConnection = async (connection: string) => {
    setLoading(true);
    await api.onboarding.connectChoice(connection);
    setLoading(false);
    navigate("/onboarding/insight");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-medium text-foreground text-center leading-relaxed">
          If you want, I can connect to a few things to help you better.
        </h1>

        <div className="space-y-3 pt-8">
          {connections.map((connection) => (
            <button
              key={connection}
              onClick={() => !loading && handleConnection(connection)}
              className="w-full p-6 bg-secondary/50 rounded-2xl text-lg font-medium text-foreground hover:bg-secondary transition-all duration-200"
            >
              {connection}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Connections;
