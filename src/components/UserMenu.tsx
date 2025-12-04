import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User as UserIcon, Settings, CreditCard, LogOut } from "lucide-react";

interface UserMenuProps {
  user?: User | null;
  isLoading?: boolean;
}

export const UserMenu = ({ user: propUser, isLoading: propIsLoading }: UserMenuProps) => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(propUser ?? null);
  const [isLoading, setIsLoading] = useState(propIsLoading ?? !propUser);

  // Sync with prop user when provided
  useEffect(() => {
    if (propUser !== undefined) {
      setUser(propUser);
    }
    if (propIsLoading !== undefined) {
      setIsLoading(propIsLoading);
    } else if (propUser !== undefined) {
      setIsLoading(false);
    }
  }, [propUser, propIsLoading]);

  // Fallback to own auth listener if no user prop
  useEffect(() => {
    if (propUser !== undefined) return; // Skip if user is provided via props

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [propUser]);

  const handleSignOut = async () => {
    console.log("Sign out clicked");
    try {
      const { error } = await supabase.auth.signOut();
      console.log("Sign out result:", { error });
      if (error) throw error;
      localStorage.removeItem("ozlon_system_name");
      localStorage.removeItem("ozlon_onboarded");
      toast.success("Signed out successfully");
      navigate("/");
    } catch (error: any) {
      console.error("Sign out error:", error);
      toast.error(error.message || "Failed to sign out");
    }
  };

  if (isLoading) {
    return (
      <div className="w-8 h-8 rounded-full bg-neutral-100 animate-pulse" />
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          to="/auth?mode=signup"
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-full",
            "border border-neutral-200 text-neutral-700",
            "hover:bg-neutral-50 transition-colors"
          )}
        >
          Sign up
        </Link>
        <Link
          to="/auth"
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-full",
            "bg-neutral-900 text-white",
            "hover:bg-neutral-800 transition-colors"
          )}
        >
          Sign in
        </Link>
      </div>
    );
  }

  const initials = user.user_metadata?.full_name
    ?.split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || user.email?.slice(0, 2).toUpperCase() || "U";

  const avatarUrl = user.user_metadata?.avatar_url;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center",
            "bg-neutral-100 hover:bg-neutral-200 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-neutral-300",
            "overflow-hidden"
          )}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-sm font-medium text-neutral-600">{initials}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-white border border-neutral-200 shadow-lg z-[200]">
        <div className="px-3 py-2">
          <p className="text-sm font-medium text-foreground truncate">
            {user.user_metadata?.full_name || "User"}
          </p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile" className="cursor-pointer">
            <UserIcon className="w-4 h-4 mr-2" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings" className="cursor-pointer">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/billing" className="cursor-pointer">
            <CreditCard className="w-4 h-4 mr-2" />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <button 
            type="button"
            onClick={handleSignOut} 
            className="w-full cursor-pointer text-destructive focus:text-destructive flex items-center"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
