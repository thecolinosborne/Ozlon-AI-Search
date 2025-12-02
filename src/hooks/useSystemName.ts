import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";

const STORAGE_KEY = "ozlon_system_name";

export function useSystemName() {
  const [systemName, setSystemName] = useState<string>(() => {
    // Check localStorage first for guests
    return localStorage.getItem(STORAGE_KEY) || "Ozlon";
  });
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsNaming, setNeedsNaming] = useState(false);

  useEffect(() => {
    const loadUserAndProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        setUser(session.user);
        
        // Fetch profile to get system name
        const { data: profile } = await supabase
          .from("profiles")
          .select("system_name")
          .eq("user_id", session.user.id)
          .single();

        if (profile?.system_name) {
          setSystemName(profile.system_name);
          localStorage.setItem(STORAGE_KEY, profile.system_name);
        } else {
          // New user - needs to name their system
          setNeedsNaming(true);
        }
      }
      
      setIsLoading(false);
    };

    loadUserAndProfile();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        setUser(session.user);
        
        // Check if new signup (needs naming)
        const { data: profile } = await supabase
          .from("profiles")
          .select("system_name")
          .eq("user_id", session.user.id)
          .single();

        if (profile?.system_name && profile.system_name !== "Ozlon") {
          setSystemName(profile.system_name);
          localStorage.setItem(STORAGE_KEY, profile.system_name);
        } else if (event === "SIGNED_IN") {
          // New signup - show naming modal
          setNeedsNaming(true);
        }
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setSystemName("Ozlon");
        localStorage.removeItem(STORAGE_KEY);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const updateSystemName = (name: string) => {
    setSystemName(name);
    localStorage.setItem(STORAGE_KEY, name);
    setNeedsNaming(false);
  };

  return {
    systemName,
    user,
    isLoading,
    needsNaming,
    setNeedsNaming,
    updateSystemName,
  };
}
