import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProfileHeroCardProps {
  isSignedIn: boolean;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
}

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const ProfileHeroCard = ({
  isSignedIn,
  displayName,
  email,
  avatarUrl,
}: ProfileHeroCardProps) => {
  const navigate = useNavigate();

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl p-5 sm:p-6 mb-10",
        "bg-gradient-to-br from-card/80 via-card/50 to-card/30",
        "border border-border/40 backdrop-blur-xl",
      )}
    >
      <div
        aria-hidden
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative flex items-center gap-4 sm:gap-5">
        <div className="rounded-full p-[2px] bg-gradient-to-br from-primary/40 to-primary/5">
          <Avatar className="w-16 h-16 sm:w-20 sm:h-20 border-2 border-background">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="text-lg font-semibold bg-muted/60 text-foreground">
              {isSignedIn ? getInitials(displayName) : "G"}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground truncate">
            {displayName}
          </h2>
          {email && isSignedIn && (
            <p className="text-sm text-muted-foreground truncate">{email}</p>
          )}
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-muted/60 border border-border/40">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                isSignedIn ? "bg-primary animate-pulse" : "bg-muted-foreground",
              )}
            />
            <span className="text-[11px] font-medium text-muted-foreground">
              {isSignedIn ? "Signed in" : "Guest"}
            </span>
          </div>
        </div>

        <div className="hidden sm:block">
          {isSignedIn ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/profile")}
              className="rounded-full"
            >
              Edit Profile
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => navigate("/auth")}
              className="rounded-full"
            >
              Sign in
            </Button>
          )}
        </div>
      </div>

      <div className="sm:hidden mt-4">
        {isSignedIn ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/profile")}
            className="w-full rounded-full"
          >
            Edit Profile
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => navigate("/auth")}
            className="w-full rounded-full"
          >
            Sign in to unlock
          </Button>
        )}
      </div>
    </div>
  );
};
