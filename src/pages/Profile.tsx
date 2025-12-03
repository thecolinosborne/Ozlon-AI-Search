import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Save, LogOut } from "lucide-react";
import { useAppStore } from "@/stores/useAppStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STORAGE_KEY = "ozlon_system_name";

const Profile = () => {
  const navigate = useNavigate();
  const { reset } = useAppStore();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);

  // Auth state listener - same pattern as UserMenu
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session?.user) {
        setIsLoading(false);
      }
    });

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session?.user) {
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load profile data when user is available
  useEffect(() => {
    if (!user || profileLoaded) return;

    const loadProfileData = async () => {
      try {
        setFullName(user.user_metadata?.full_name || "");

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) {
          console.error("Error loading profile:", error);
        }

        if (profile) {
          setFullName(profile.full_name || user.user_metadata?.full_name || "");
          setUsername(profile.username || "");
        }
      } catch (error) {
        console.error("Profile load error:", error);
      } finally {
        setIsLoading(false);
        setProfileLoaded(true);
      }
    };

    loadProfileData();
  }, [user, profileLoaded]);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({ 
          user_id: user.id,
          full_name: fullName, 
          username 
        }, { 
          onConflict: 'user_id' 
        });

      if (error) throw error;
      toast.success("Profile updated");
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(error.message || "Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      reset();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("ozlon_onboarded");
      toast.success("Signed out successfully");
      navigate("/");
    } catch (error: any) {
      console.error("Sign out error:", error);
      toast.error(error.message || "Failed to sign out");
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-muted border-t-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  // If no user, show sign in prompt
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center px-4">
          <h2 className="text-xl font-semibold text-foreground mb-2">Sign in required</h2>
          <p className="text-muted-foreground mb-6">Please sign in to view your profile</p>
          <button
            onClick={() => navigate("/auth")}
            className="px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-lg font-medium text-foreground">Profile</h1>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center",
              "bg-muted overflow-hidden"
            )}>
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-2xl font-medium text-muted-foreground">
                  {fullName?.slice(0, 2).toUpperCase() || user.email?.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <p className="font-medium text-foreground">{fullName || "User"}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Full name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={cn(
                  "w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                  "placeholder:text-muted-foreground"
                )}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
                className={cn(
                  "w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                  "placeholder:text-muted-foreground"
                )}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Email
              </label>
              <input
                type="email"
                value={user.email || ""}
                disabled
                className={cn(
                  "w-full px-4 py-3 rounded-lg border border-border",
                  "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Email cannot be changed
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 pt-4">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={cn(
                "flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium",
                "bg-primary text-primary-foreground",
                "hover:bg-primary/90 transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <Save className="w-4 h-4" />
              {isSaving ? "Saving..." : "Save changes"}
            </button>

            <button
              onClick={() => setShowSignOutDialog(true)}
              className={cn(
                "flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium",
                "bg-destructive/10 text-destructive",
                "hover:bg-destructive/20 transition-colors"
              )}
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      </main>

      {/* Sign Out Confirmation Dialog */}
      <AlertDialog open={showSignOutDialog} onOpenChange={setShowSignOutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to sign out? You'll need to sign in again to access your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSignOut} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Profile;