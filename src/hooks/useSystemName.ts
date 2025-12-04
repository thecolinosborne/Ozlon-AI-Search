import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";

const STORAGE_KEY = "ozlon_system_name";
const ONBOARDED_KEY = "ozlon_onboarded";

export type AuthState = "loading" | "authenticated" | "unauthenticated";

export function useSystemName() {
  // Start with default name - don't read from localStorage until auth is verified
  const [systemName, setSystemName] = useState<string>("Ozlon");
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Derived states for convenience
  const isLoading = authState === "loading";
  const isAuthenticated = authState === "authenticated";

  const checkUserProfile = useCallback(async (userId: string, isNewSignup: boolean) => {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("system_name")
        .eq("user_id", userId)
        .single();

      if (profile?.system_name && profile.system_name !== "Ozlon") {
        // User has a custom name - they've completed onboarding before
        setSystemName(profile.system_name);
        localStorage.setItem(STORAGE_KEY, profile.system_name);
        localStorage.setItem(ONBOARDED_KEY, "true");
        setIsReturningUser(true);
        setNeedsOnboarding(false);
      } else if (isNewSignup || !localStorage.getItem(ONBOARDED_KEY)) {
        // New signup or never completed onboarding
        setNeedsOnboarding(true);
        setIsReturningUser(false);
        // Keep default "Ozlon" name
      } else {
        // Returning user who kept default name
        setIsReturningUser(true);
        setNeedsOnboarding(false);
      }
      
      setProfileLoaded(true);
    } catch (error) {
      console.error("Error checking user profile:", error);
      setProfileLoaded(true);
    }
  }, []);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setSystemName("Ozlon");
    setNeedsOnboarding(false);
    setIsReturningUser(false);
    setProfileLoaded(false);
    setAuthState("unauthenticated");
    // Clear localStorage
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ONBOARDED_KEY);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadUserAndProfile = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
          setAuthState("authenticated");
          await checkUserProfile(session.user.id, false);
        } else {
          // No session - user is not authenticated
          clearAuthState();
        }
      } catch (error) {
        console.error("Error loading session:", error);
        if (mounted) {
          clearAuthState();
        }
      }
    };

    loadUserAndProfile();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      console.log("Auth state change:", event);

      if (event === "SIGNED_IN" && session?.user) {
        setUser(session.user);
        setAuthState("authenticated");
        
        // Check if this is a new signup (user created just now)
        const createdAt = new Date(session.user.created_at);
        const now = new Date();
        const isNewSignup = (now.getTime() - createdAt.getTime()) < 60000;
        
        await checkUserProfile(session.user.id, isNewSignup);
      } else if (event === "SIGNED_OUT") {
        clearAuthState();
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        // Keep current state, just update user if needed
        setUser(session.user);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [checkUserProfile, clearAuthState]);

  const completeOnboarding = async (name: string) => {
    setSystemName(name);
    localStorage.setItem(STORAGE_KEY, name);
    localStorage.setItem(ONBOARDED_KEY, "true");
    setNeedsOnboarding(false);
    
    // Also update in database if user is authenticated
    if (user) {
      try {
        await supabase
          .from("profiles")
          .update({ system_name: name })
          .eq("user_id", user.id);
      } catch (error) {
        console.error("Error saving system name to profile:", error);
      }
    }
  };

  // Only return personalized system name if authenticated and profile loaded
  const displaySystemName = isAuthenticated && profileLoaded ? systemName : "Ozlon";

  return {
    systemName: displaySystemName,
    user,
    isLoading,
    isAuthenticated,
    authState,
    needsOnboarding,
    isReturningUser,
    profileLoaded,
    completeOnboarding,
  };
}
