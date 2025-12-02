import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/useAppStore";
import { AIOrb } from "@/components/AIOrb";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "signup";

const Auth = () => {
  const navigate = useNavigate();
  const { setUser, user } = useAppStore();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    // TODO: Wire to Supabase auth - onLogin/onSignup callbacks
    // Simulated auth for now
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (!email || !password) {
      setError("Please fill in all fields");
      setLoading(false);
      return;
    }

    // Create mock user
    setUser({
      id: "mock-user-id",
      email,
      name: email.split("@")[0],
      orbName: user?.orbName || "Orb",
      communicationMode: user?.communicationMode || "both",
      dailyStructure: user?.dailyStructure || "mixed",
      priorityDomains: user?.priorityDomains || [],
      existingSystems: user?.existingSystems || [],
      insightStyle: user?.insightStyle || "adaptive",
      onboardingComplete: user?.onboardingComplete || false,
    });

    setLoading(false);

    // Redirect based on onboarding status
    if (user?.onboardingComplete) {
      navigate("/chat");
    } else {
      navigate("/onboarding");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex flex-col items-center justify-center px-6 safe-area-top safe-area-bottom">
      {/* Orb Background */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
        <div className="scale-[4]">
          <AIOrb breatheIn={true} />
        </div>
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <AIOrb breatheIn={true} />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "login"
              ? "Sign in to continue to your Orb"
              : "Set up your account to begin"}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full h-14 pl-12 pr-4 rounded-2xl bg-card/60 border border-border/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full h-14 pl-12 pr-12 rounded-2xl bg-card/60 border border-border/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          {/* Submit */}
          <Button
            type="submit"
            disabled={loading}
            className="w-full h-14 rounded-2xl text-base font-medium"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <>
                {mode === "login" ? "Sign in" : "Create account"}
                <ArrowRight className="w-5 h-5 ml-2" />
              </>
            )}
          </Button>
        </form>

        {/* Toggle Mode */}
        <div className="mt-8 text-center">
          <button
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {mode === "login" ? (
              <>
                New to the Orb? <span className="text-primary font-medium">Create account</span>
              </>
            ) : (
              <>
                Already have an account? <span className="text-primary font-medium">Sign in</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
