import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { GauntletPanel } from "@/components/gauntlet/GauntletPanel";

const ModelRouting = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 pb-24">
      <header className="border-b border-border/50 px-4 py-4 safe-area-top">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/settings")}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">The Brain</h1>
            <p className="text-xs text-muted-foreground">One mind. Many lobes. Auto-tuned to the moment.</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        <GauntletPanel />
      </div>
    </div>
  );
};

export default ModelRouting;
