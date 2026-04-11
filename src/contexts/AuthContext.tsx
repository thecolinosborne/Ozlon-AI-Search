import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STORAGE_KEY = "ozlon_system_name";
const ONBOARDED_KEY = "ozlon_onboarded";

interface AuthContextType {
  // Core auth state
  authLoading: boolean;
  session: Session | null;
  user: User | null;
  
  // Profile state
  systemName: string;
  profileLoaded: boolean;
  needsOnboarding: boolean;
  isReturningUser: boolean;
  
  // Voice settings
  voiceEnabled: boolean;
  
  // Actions
  signOut: () => Promise<void>;
  completeOnboarding: (name: string) => Promise<void>;
  setVoiceEnabled: (enabled: boolean) => Promise<void>;
  refreshVoiceSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Core auth state - single source of truth
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  
  // Profile state
  const [systemName, setSystemName] = useState("Ozlon");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  
  // Voice settings
  const [voiceEnabled, setVoiceEnabledState] = useState(false);

  // Clear all auth state - used on sign out
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
    
    // Clear localStorage
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ONBOARDED_KEY);
  }, []);

  // Load user profile from Supabase
  const loadUserProfile = useCallback(async (userId: string, isNewSignup: boolean) => {
    console.log("Loading user profile for:", userId, "isNewSignup:", isNewSignup);
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("system_name, voice_enabled, elevenlabs_voice_id")
        .eq("user_id", userId)
        .single();

      console.log("Profile loaded:", profile, "error:", error);

      // Check if user has completed onboarding
      const hasCustomName = profile?.system_name && profile.system_name !== "Ozlon";
      const wasOnboarded = localStorage.getItem(ONBOARDED_KEY) === "true";
      
      console.log("Onboarding check:", { hasCustomName, wasOnboarded, isNewSignup });

      if (hasCustomName) {
        // User has a custom name, they've completed onboarding
        setSystemName(profile.system_name);
        localStorage.setItem(STORAGE_KEY, profile.system_name);
        localStorage.setItem(ONBOARDED_KEY, "true");
        setIsReturningUser(true);
        setNeedsOnboarding(false);
        console.log("User has completed onboarding previously");
      } else if (isNewSignup) {
        // New signup - definitely needs onboarding
        setNeedsOnboarding(true);
        setIsReturningUser(false);
        console.log("New signup - needs onboarding");
      } else if (!wasOnboarded) {
        // Not onboarded yet according to localStorage
        setNeedsOnboarding(true);
        setIsReturningUser(false);
        console.log("Not onboarded according to localStorage - needs onboarding");
      } else {
        // Was onboarded but has default name
        setIsReturningUser(true);
        setNeedsOnboarding(false);
        console.log("Returning user with default name");
      }
      
      // Set voice enabled state from profile
      setVoiceEnabledState(profile?.voice_enabled ?? false);
      
      setProfileLoaded(true);
    } catch (error) {
      console.error("Error loading user profile:", error);
      setProfileLoaded(true);
    }
  }, []);

  // Refresh voice settings from database
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
      console.error("Error refreshing voice settings:", error);
    }
  }, [user]);

  // Set voice enabled - saves to database
  const setVoiceEnabled = useCallback(async (enabled: boolean) => {
    console.log("setVoiceEnabled called with:", enabled, "user:", user?.id);
    
    if (!user) {
      console.error("No user found - cannot update voice setting");
      toast.error("Sign in to enable voice conversation");
      return;
    }
    
    // Optimistically update UI first
    setVoiceEnabledState(enabled);
    
    try {
      console.log("Updating voice_enabled to:", enabled, "for user:", user.id);
      const { error, data } = await supabase
        .from("profiles")
        .update({ voice_enabled: enabled })
        .eq("user_id", user.id)
        .select();
      
      console.log("Update result:", { error, data });
      
      if (error) {
        // Revert on error
        setVoiceEnabledState(!enabled);
        throw error;
      }
      
      toast.success(enabled ? "Custom voice enabled" : "Custom voice disabled");
    } catch (error: any) {
      console.error("Error updating voice setting:", error);
      toast.error(error?.message || "Failed to update voice setting");
    }
  }, [user]);

  // Sign out handler
  const signOut = useCallback(async () => {
    console.log("Signing out...");
    // Clear state first to prevent re-renders from triggering profile loads
    clearAuthState();
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        console.error("Sign out API error:", error);
      }
      toast.success("Signed out successfully");
    } catch (error: any) {
      console.error("Sign out error:", error);
      toast.error(error.message || "Failed to sign out");
    }
  }, [clearAuthState]);

  // Complete onboarding
  const completeOnboarding = useCallback(async (name: string) => {
    setSystemName(name);
    localStorage.setItem(STORAGE_KEY, name);
    localStorage.setItem(ONBOARDED_KEY, "true");
    setNeedsOnboarding(false);
    
    if (user) {
      try {
        await supabase
          .from("profiles")
          .update({ system_name: name })
          .eq("user_id", user.id);
      } catch (error) {
        console.error("Error saving system name:", error);
      }
    }
  }, [user]);

  // Initialize auth state
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      console.log("Initializing auth...");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!mounted) return;

        if (session?.user) {
          console.log("Found existing session");
          setSession(session);
          setUser(session.user);
          await loadUserProfile(session.user.id, false);
        } else {
          console.log("No existing session");
          clearAuthState();
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
        if (mounted) clearAuthState();
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      
      console.log("Auth state changed:", event);

      if (event === "SIGNED_IN" && session?.user) {
        setSession(session);
        setUser(session.user);
        setAuthLoading(false);
        
        const createdAt = new Date(session.user.created_at);
        const now = new Date();
        const isNewSignup = (now.getTime() - createdAt.getTime()) < 60000;
        
        await loadUserProfile(session.user.id, isNewSignup);
      } else if (event === "SIGNED_OUT") {
        clearAuthState();
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        setSession(session);
        setUser(session.user);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserProfile, clearAuthState]);

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
