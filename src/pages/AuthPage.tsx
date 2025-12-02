import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { z } from "zod";

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

const AuthPage = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        navigate("/");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};
    
    try {
      emailSchema.parse(email);
    } catch (e) {
      if (e instanceof z.ZodError) {
        newErrors.email = e.errors[0].message;
      }
    }

    try {
      passwordSchema.parse(password);
    } catch (e) {
      if (e instanceof z.ZodError) {
        newErrors.password = e.errors[0].message;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in successfully");
      } else {
        const redirectUrl = `${window.location.origin}/`;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account");
      }
    } catch (error: any) {
      const message = error.message || "Authentication failed";
      if (message.includes("User already registered")) {
        toast.error("This email is already registered. Please sign in instead.");
      } else if (message.includes("Invalid login credentials")) {
        toast.error("Invalid email or password");
      } else {
        toast.error(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message || "Google sign in failed");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-light text-neutral-800 mb-2">Ozlon</h1>
          <p className="text-neutral-500">Your Personal Operating System</p>
        </div>

        {/* Auth Card */}
        <div className="bg-white border border-neutral-200 rounded-2xl p-8 shadow-sm">
          <h2 className="text-xl font-medium text-neutral-800 mb-6 text-center">
            {isLogin ? "Welcome back" : "Create your account"}
          </h2>

          {/* Google Auth */}
          <button
            onClick={handleGoogleAuth}
            disabled={isLoading}
            className={cn(
              "w-full flex items-center justify-center gap-3 px-4 py-3 rounded-full",
              "border border-neutral-200 text-neutral-700",
              "hover:bg-neutral-50 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-neutral-200" />
            <span className="text-sm text-neutral-400">or</span>
            <div className="flex-1 h-px bg-neutral-200" />
          </div>

          {/* Email Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {!isLogin && (
              <div>
                <input
                  type="text"
                  placeholder="Full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={cn(
                    "w-full px-4 py-3 rounded-lg border border-neutral-200",
                    "focus:outline-none focus:border-neutral-400",
                    "placeholder:text-neutral-400"
                  )}
                />
              </div>
            )}

            <div>
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                className={cn(
                  "w-full px-4 py-3 rounded-lg border",
                  errors.email ? "border-red-400" : "border-neutral-200",
                  "focus:outline-none focus:border-neutral-400",
                  "placeholder:text-neutral-400"
                )}
              />
              {errors.email && (
                <p className="text-sm text-red-500 mt-1">{errors.email}</p>
              )}
            </div>

            <div>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((prev) => ({ ...prev, password: undefined }));
                }}
                className={cn(
                  "w-full px-4 py-3 rounded-lg border",
                  errors.password ? "border-red-400" : "border-neutral-200",
                  "focus:outline-none focus:border-neutral-400",
                  "placeholder:text-neutral-400"
                )}
              />
              {errors.password && (
                <p className="text-sm text-red-500 mt-1">{errors.password}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                "w-full py-3 rounded-full font-medium",
                "bg-neutral-900 text-white",
                "hover:bg-neutral-800 transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isLoading ? "Loading..." : isLogin ? "Sign in" : "Create account"}
            </button>
          </form>

          {/* Toggle */}
          <p className="text-center mt-6 text-sm text-neutral-600">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setErrors({});
              }}
              className="text-neutral-900 font-medium hover:underline"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
