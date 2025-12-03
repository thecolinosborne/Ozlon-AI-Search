import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";

const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error("Session error:", sessionError);
          if (isMounted) {
            setIsLoading(false);
            navigate("/auth");
          }
          return;
        }

        if (!session?.user) {
          if (isMounted) {
            setIsLoading(false);
            navigate("/auth");
          }
          return;
        }
        
        if (!isMounted) return;

        setUser(session.user);
        setFullName(session.user.user_metadata?.full_name || "");

        // Fetch profile from database
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (error) {
          console.error("Error loading profile:", error);
        }

        if (isMounted) {
          if (profile) {
            setFullName(profile.full_name || session.user.user_metadata?.full_name || "");
            setUsername(profile.username || "");
          }
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Profile load error:", error);
        if (isMounted) {
          setIsLoading(false);
          navigate("/auth");
        }
      }
    };

    // Set a timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      if (isMounted && isLoading) {
        console.warn("Profile load timeout");
        setIsLoading(false);
        navigate("/auth");
      }
    }, 5000);

    loadProfile();

    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [navigate]);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);

    try {
      // Try to upsert the profile (insert if doesn't exist, update if it does)
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-muted border-t-foreground rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  // If no user after loading, show message
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Please sign in to view your profile</p>
          <button
            onClick={() => navigate("/auth")}
            className="px-4 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
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
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-2xl font-medium text-muted-foreground">
                  {fullName?.slice(0, 2).toUpperCase() || user?.email?.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <p className="font-medium text-foreground">{fullName || "User"}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
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
                  "focus:outline-none focus:border-ring",
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
                  "focus:outline-none focus:border-ring",
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
                value={user?.email || ""}
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

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-full font-medium",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Save className="w-4 h-4" />
            {isSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </main>
    </div>
  );
};

export default Profile;