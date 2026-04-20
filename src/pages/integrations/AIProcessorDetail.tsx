import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Brain } from "lucide-react";

const AIProcessorDetail = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => navigate("/settings/brain", { replace: true }), 1500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Brain className="w-7 h-7 text-primary" strokeWidth={1.5} />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Moved to The Brain</h1>
        <p className="text-sm text-muted-foreground">
          The AI Processor is now part of <strong>Settings → The Brain</strong>. Redirecting…
        </p>
        <button
          onClick={() => navigate("/settings/brain", { replace: true })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Go to The Brain
        </button>
      </div>
    </div>
  );
};

export default AIProcessorDetail;
