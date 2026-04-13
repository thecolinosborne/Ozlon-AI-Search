import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAppStore } from "@/stores/useAppStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User as UserIcon, Settings, CreditCard, LogOut, ClipboardList } from "lucide-react";

export const UserMenu = () => {
  const navigate = useNavigate();
  const { authLoading, session, user, signOut } = useAuth();
  const resetStore = useAppStore((state) => state.reset);

  // State 1: Loading - show skeleton
  if (authLoading) {
    return (
      <div className="w-9 h-9 rounded-full bg-neutral-100 animate-pulse" />
    );
  }

  // State 2: Not authenticated - show sign in/up buttons
  if (!session || !user) {
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

  // State 3: Authenticated - show user menu
  const initials = user.user_metadata?.full_name
    ?.split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || user.email?.slice(0, 2).toUpperCase() || "U";

  const avatarUrl = user.user_metadata?.avatar_url;

  const handleSignOut = async () => {
    console.log("Sign out clicked");
    resetStore(); // Clear all app state
    await signOut();
    navigate("/");
  };

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
          <Link to="/tasks" className="cursor-pointer">
            <ClipboardList className="w-4 h-4 mr-2" />
            Tasks
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
        <DropdownMenuItem 
          onClick={handleSignOut}
          className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
