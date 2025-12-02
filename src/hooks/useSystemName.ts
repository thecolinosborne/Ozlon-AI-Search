import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";

const STORAGE_KEY = "ozlon_system_name";
const ONBOARDED_KEY = "ozlon_onboarded";

export function useSystemName() {
  const [systemName, setSystemName] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || "Ozlon";
  });
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);

  const checkUserProfile = useCallback(async (userId: string, isNewSignup: boolean) => {
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
    } else {
      // Returning user who kept default name
      setIsReturningUser(true);
      setNeedsOnboarding(false);
    }
  }, []);

  useEffect(() => {
    const loadUserAndProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        setUser(session.user);
        await checkUserProfile(session.user.id, false);
      }
      
      setIsLoading(false);
    };

    loadUserAndProfile();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        setUser(session.user);
        // Check if this is a new signup (user created just now)
        const createdAt = new Date(session.user.created_at);
        const now = new Date();
        const isNewSignup = (now.getTime() - createdAt.getTime()) < 60000; // Within last minute
        
        await checkUserProfile(session.user.id, isNewSignup);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setSystemName("Ozlon");
        setNeedsOnboarding(false);
        setIsReturningUser(false);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(ONBOARDED_KEY);
      }
    });

    return () => subscription.unsubscribe();
  }, [checkUserProfile]);

  const completeOnboarding = (name: string) => {
    setSystemName(name);
    localStorage.setItem(STORAGE_KEY, name);
    localStorage.setItem(ONBOARDED_KEY, "true");
    setNeedsOnboarding(false);
  };

  return {
    systemName,
    user,
    isLoading,
    needsOnboarding,
    isReturningUser,
    completeOnboarding,
  };
}
