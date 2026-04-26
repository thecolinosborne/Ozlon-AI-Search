import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SignalSurface } from "@/components/signals/SignalSurface";

export default function Signals() {
  return (
    <div className="relative min-h-screen bg-background">
      <Link
        to="/"
        className="fixed top-6 left-6 z-50 p-2 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft className="w-4 h-4" />
      </Link>
      <SignalSurface variant="page" maxMoments={1} />
    </div>
  );
}
