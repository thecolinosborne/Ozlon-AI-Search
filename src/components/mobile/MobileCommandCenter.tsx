import { CalendarDays, Compass, ListChecks, Mic, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface MobileCommandCenterProps {
  systemName: string;
  firstName?: string;
  onSpeak: () => void;
  isRecording: boolean;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function MobileCommandCenter({ systemName, firstName, onSpeak, isRecording }: MobileCommandCenterProps) {
  return (
    <main className="flex min-h-[calc(100dvh-4rem)] flex-col px-4 pb-2 pt-[calc(6rem+env(safe-area-inset-top))] md:hidden">
      <section className="px-1 pt-2 max-[600px]:pt-0">
        <p className="text-sm font-medium text-muted-foreground">{systemName}</p>
        <h1 className="mt-1 text-3xl font-medium text-foreground">
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">What needs your attention today?</p>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center py-6 max-[600px]:py-3">
        <Button
          type="button"
          size="icon"
          onClick={onSpeak}
          aria-label={isRecording ? "Stop recording" : `Speak to ${systemName}`}
          className="h-28 w-28 rounded-full border border-primary/20 bg-primary/10 text-primary shadow-[var(--button-glow)] hover:bg-primary/15 max-[600px]:h-24 max-[600px]:w-24"
        >
          <Mic className="h-10 w-10" />
        </Button>
        <p className="mt-5 text-xs font-medium uppercase text-muted-foreground max-[600px]:mt-3">{isRecording ? "Listening" : "Tap to speak"}</p>
      </section>

      <section className="grid grid-cols-2 gap-2" aria-label="Daily tools">
        <Destination to="/signals#schedule" icon={CalendarDays} title="Schedule" detail="Meetings and plans" />
        <Destination to="/life" icon={Compass} title="Life OS" detail="Goals and progress" />
        <Destination to="/signals" icon={ListChecks} title="Today" detail="Priorities and risks" />
        <Destination to="/?compose=1" icon={MessageCircle} title="Chat" detail="Ask or take action" />
      </section>
    </main>
  );
}

function Destination({ to, icon: Icon, title, detail }: { to: string; icon: typeof CalendarDays; title: string; detail: string }) {
  return (
    <Button asChild variant="outline" className="h-[74px] items-start justify-start rounded-lg p-3 text-left max-[600px]:h-16 max-[600px]:p-2.5">
      <Link to={to}>
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">{detail}</span>
        </span>
      </Link>
    </Button>
  );
}