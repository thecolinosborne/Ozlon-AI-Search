import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, Compass, Home, MessageCircle, MoreHorizontal, Brain, Inbox, Settings, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const primaryItems = [
  { label: "Today", to: "/signals", icon: Home },
  { label: "Chat", to: "/?compose=1", icon: MessageCircle },
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
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!session || location.pathname.startsWith("/auth") || location.pathname.startsWith("/onboarding")) return null;

  const isActive = (to: string) => {
    if (to.startsWith("/?compose=1")) return location.pathname === "/";
    if (to.includes("#schedule")) return location.pathname === "/signals" && location.hash === "#schedule";
    return location.pathname === to && !location.hash;
  };

  const openDestination = (to: string) => {
    setMoreOpen(false);
    navigate(to);
  };

  const openSchedule = () => {
    setMoreOpen(false);
    if (location.pathname !== "/signals" || location.hash !== "#schedule") {
      navigate("/signals#schedule");
      return;
    }
    document.getElementById("schedule")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden="true" />
      <nav className="fixed inset-x-0 bottom-0 z-[100] border-t border-border/60 bg-background/90 backdrop-blur-xl md:hidden safe-area-bottom" aria-label="Primary navigation">
        <div className="grid h-16 grid-cols-5 items-stretch px-1">
          {primaryItems.map(({ label, to, icon: Icon }) => (
            <Button key={label} asChild variant="ghost" className={cn(
              "h-16 min-w-0 flex-col gap-1 rounded-none px-0 text-[10px] font-medium text-muted-foreground",
              isActive(to) && "text-primary"
            )}>
              <Link
                to={to}
                onClick={to.includes("#schedule") ? (event) => { event.preventDefault(); openSchedule(); } : undefined}
                aria-current={isActive(to) ? "page" : undefined}
              >
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
        <SheetContent side="bottom" className="bottom-[calc(4.25rem+env(safe-area-inset-bottom))] max-h-[calc(100dvh-5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain rounded-t-2xl border-border/60 pb-5 md:hidden">
          <SheetHeader className="text-left">
            <SheetTitle>More</SheetTitle>
            <SheetDescription>Open your memory, messages, people, or settings.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {moreItems.map(({ label, to, icon: Icon }) => (
              <Button key={label} asChild variant="outline" className="h-14 justify-start rounded-lg px-4">
                <Link to={to} onClick={(event) => { event.preventDefault(); openDestination(to); }}>
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