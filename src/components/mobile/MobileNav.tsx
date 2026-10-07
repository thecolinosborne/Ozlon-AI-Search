import { Link, useLocation } from "react-router-dom";
import { MessageCircle, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const items = [
  { label: "Assistant", to: "/", icon: MessageCircle },
  { label: "Settings", to: "/settings", icon: Settings },
] as const;

export function MobileNav() {
  const { session } = useAuth();
  const location = useLocation();

  if (!session || location.pathname.startsWith("/auth") || location.pathname.startsWith("/onboarding") || location.pathname.startsWith("/preview")) return null;

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname !== "/";

  return (
    <>
      <div className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden="true" />
      <nav className="fixed inset-x-0 bottom-0 z-[100] border-t border-border/60 bg-background/90 backdrop-blur-xl md:hidden pb-[env(safe-area-inset-bottom)]" aria-label="Primary navigation">
        <div className="grid h-16 grid-cols-2 items-stretch px-6">
          {items.map(({ label, to, icon: Icon }) => (
            <Button key={label} asChild variant="ghost" className={cn(
              "h-16 min-w-0 flex-col gap-1 rounded-none px-0 text-[11px] font-medium text-muted-foreground",
              isActive(to) && "text-primary"
            )}>
              <Link to={to} aria-current={isActive(to) ? "page" : undefined}>
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </Link>
            </Button>
          ))}
        </div>
      </nav>
    </>
  );
}
