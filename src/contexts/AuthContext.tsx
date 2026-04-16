import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { handleError } from "@/lib/handleError";
import { toast } from "sonner";

const STORAGE_KEY = "ozlon_system_name";
const ONBOARDED_KEY = "ozlon_onboarded";
const AUTH_INIT_TIMEOUT = 5000; // 5s failsafe

interface AuthContextType {
  authLoading: boolean;
  session: Session | null;
  user: User | null;
  systemName: string;
  profileLoaded: boolean;
  needsOnboarding: boolean;
  isReturningUser: boolean;
  voiceEnabled: boolean;
  signOut: () => Promise<void>;
  completeOnboarding: (name: string) => Promise<void>;
  setVoiceEnabled: (enabled: boolean) => Promise<void>;
  refreshVoiceSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [systemName, setSystemName] = useState("Ozlon");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [voiceEnabled, setVoiceEnabledState] = useState(false);

  const clearAuthState = useCallback(() => {
    console.log("Clearing auth state");
    setSession(null);
    setUser(null);
    setSystemName("Ozlon");
    setProfileLoaded(false);
    setNeedsOnboarding(false);
    setIsReturningUser(false);
    setVoiceEnabledState(false);
    setAuthLoading(false);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ONBOARDED_KEY);
  }, []);

  const loadUserProfile = useCallback(async (userId: string, _isNewSignup: boolean) => {
    console.log("Loading user profile for:", userId);
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("system_name, voice_enabled, elevenlabs_voice_id, onboarding_complete")
        .eq("user_id", userId)
        .single();

      console.log("Profile loaded:", profile, "error:", error);

      const onboardingDone = profile?.onboarding_complete === true;
      const wasOnboarded = localStorage.getItem(ONBOARDED_KEY) === "true";

      if (onboardingDone) {
        const name = profile?.system_name || "Ozlon";
        setSystemName(name);
        localStorage.setItem(STORAGE_KEY, name);
        localStorage.setItem(ONBOARDED_KEY, "true");
        setIsReturningUser(true);
        setNeedsOnboarding(false);
      } else if (wasOnboarded) {
        const name = profile?.system_name || localStorage.getItem(STORAGE_KEY) || "Ozlon";
        setSystemName(name);
        setIsReturningUser(true);
        setNeedsOnboarding(false);
        supabase.from("profiles").update({ onboarding_complete: true }).eq("user_id", userId).then(() => {});
      } else {
        setNeedsOnboarding(true);
        setIsReturningUser(false);
      }

      setVoiceEnabledState(profile?.voice_enabled ?? false);
      setProfileLoaded(true);
    } catch (error) {
      handleError(error, "Error loading user profile", { silent: true });
      setProfileLoaded(true);
    }
  }, []);

  const startAuthenticatedSession = useCallback((nextSession: Session, isNewSignup: boolean) => {
    setSession(nextSession);
    setUser(nextSession.user);
    setAuthLoading(false);
    setProfileLoaded(false);

    void loadUserProfile(nextSession.user.id, isNewSignup);
  }, [loadUserProfile]);

  const refreshVoiceSettings = useCallback(async () => {
    if (!user) return;
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("voice_enabled")
        .eq("user_id", user.id)
        .single();
      setVoiceEnabledState(profile?.voice_enabled ?? false);
    } catch (error) {
      handleError(error, "Error refreshing voice settings", { silent: true });
    }
  }, [user]);

  const setVoiceEnabled = useCallback(async (enabled: boolean) => {
    if (!user) {
      toast.error("Sign in to enable voice conversation");
      return;
    }
    setVoiceEnabledState(enabled);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ voice_enabled: enabled })
        .eq("user_id", user.id)
        .select();
      if (error) {
        setVoiceEnabledState(!enabled);
        throw error;
      }
      toast.success(enabled ? "Custom voice enabled" : "Custom voice disabled");
    } catch (error: unknown) {
      handleError(error, "Failed to update voice setting");
    }
  }, [user]);

  const signOut = useCallback(async () => {
    console.log("Signing out...");
    clearAuthState();
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) console.error("Sign out API error:", error);
      toast.success("Signed out successfully");
    } catch (error: unknown) {
      handleError(error, "Failed to sign out");
    }
  }, [clearAuthState]);

  const completeOnboarding = useCallback(async (name: string) => {
    setSystemName(name);
    localStorage.setItem(STORAGE_KEY, name);
    localStorage.setItem(ONBOARDED_KEY, "true");
    setNeedsOnboarding(false);
    if (user) {
      try {
        await supabase.from("profiles").update({ system_name: name }).eq("user_id", user.id);
      } catch (error) {
        handleError(error, "Error saving system name", { silent: true });
      }
    }
  }, [user]);

  // Initialize auth — register listener BEFORE getSession
  useEffect(() => {
    let mounted = true;

    // Failsafe: if authLoading hasn't resolved in AUTH_INIT_TIMEOUT, force it
    const failsafeTimer = setTimeout(() => {
      if (mounted) {
        console.warn("Auth init failsafe triggered — forcing authLoading=false");
        setAuthLoading(false);
      }
    }, AUTH_INIT_TIMEOUT);

    // 1. Register listener first so we never miss an event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      console.log("Auth state changed:", event);

      if (event === "SIGNED_IN" && newSession?.user) {
        const createdAt = new Date(newSession.user.created_at);
        const now = new Date();
        const isNewSignup = (now.getTime() - createdAt.getTime()) < 60000;
        startAuthenticatedSession(newSession, isNewSignup);
      } else if (event === "SIGNED_OUT") {
        clearAuthState();
      } else if ((event === "TOKEN_REFRESHED" || event === "USER_UPDATED") && newSession?.user) {
        setSession(newSession);
        setUser(newSession.user);
        setAuthLoading(false);
      } else if (event === "INITIAL_SESSION" && !newSession) {
        setAuthLoading(false);
      }
    });

    // 2. Then fetch the current session
    const initializeAuth = async () => {
      console.log("Initializing auth...");
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!mounted) return;

        if (currentSession?.user) {
          console.log("Found existing session");
          startAuthenticatedSession(currentSession, false);
        } else {
          console.log("No existing session");
          clearAuthState();
        }
      } catch (error) {
        handleError(error, "Error initializing auth", { silent: true });
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
      clearTimeout(failsafeTimer);
      subscription.unsubscribe();
    };
  }, [clearAuthState, startAuthenticatedSession]);

  return (
    <AuthContext.Provider
      value={{
        authLoading,
        session,
        user,
        systemName,
        profileLoaded,
        needsOnboarding,
        isReturningUser,
        voiceEnabled,
        signOut,
        completeOnboarding,
        setVoiceEnabled,
        refreshVoiceSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
