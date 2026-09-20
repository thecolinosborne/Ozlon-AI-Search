import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarDays, Compass, Home, MessageCircle, MoreHorizontal, Brain, Inbox, Settings, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const primaryItems = [
  { label: "Today", to: "/signals", icon: Home },
  { label: "Chat", to: "/", icon: MessageCircle },
  { label: "Life OS", to: "/life", icon: Compass },
  { label: "Schedule", to: "/signals#schedule", icon: CalendarDays },
] as const;

const moreItems = [
  { label: "Memory", to: "/memory", icon: Brain },
  { label: "Messages", to: "/communications", icon: Inbox },
  { label: "People", to: "/people", icon: Users },
  { label: "Settings", to: "/settings", icon: Settings },
] as const;

export function MobileNav() {
  const { session } = useAuth();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!session || location.pathname.startsWith("/auth") || location.pathname.startsWith("/onboarding")) return null;

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    if (to.includes("#schedule")) return location.pathname === "/signals" && location.hash === "#schedule";
    return location.pathname === to && !location.hash;
  };

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-[100] border-t border-border/60 bg-background/90 backdrop-blur-xl md:hidden safe-area-bottom" aria-label="Primary navigation">
        <div className="grid h-16 grid-cols-5 items-stretch px-1">
          {primaryItems.map(({ label, to, icon: Icon }) => (
            <Button key={label} asChild variant="ghost" className={cn(
              "h-16 min-w-0 flex-col gap-1 rounded-none px-0 text-[10px] font-medium text-muted-foreground",
              isActive(to) && "text-primary"
            )}>
              <Link to={to} aria-current={isActive(to) ? "page" : undefined}>
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate">{label}</span>
              </Link>
            </Button>
          ))}
          <Button variant="ghost" onClick={() => setMoreOpen(true)} className={cn(
            "h-16 min-w-0 flex-col gap-1 rounded-none px-0 text-[10px] font-medium text-muted-foreground",
            moreItems.some((item) => location.pathname === item.to) && "text-primary"
          )}>
            <MoreHorizontal className="h-5 w-5" />
            <span>More</span>
          </Button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl border-border/60 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] md:hidden">
          <SheetHeader className="text-left">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {moreItems.map(({ label, to, icon: Icon }) => (
              <Button key={label} asChild variant="outline" className="h-14 justify-start rounded-lg px-4">
                <Link to={to} onClick={() => setMoreOpen(false)}>
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  {label}
                </Link>
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}