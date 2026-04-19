import { useLocation, useNavigate } from "react-router-dom";
import { Home, CalendarDays, ListChecks, Plug, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", icon: Home, label: "Home" },
  { path: "/tasks", icon: ListChecks, label: "Tasks" },
  { path: "/events", icon: CalendarDays, label: "Events" },
  { path: "/integrations", icon: Plug, label: "Integrations" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

export const TopNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="flex items-center gap-1 p-1 rounded-full bg-muted/40 backdrop-blur-sm">
      {navItems.map(({ path, icon: Icon, label }) => {
        const isActive =
          path === "/"
            ? location.pathname === "/"
            : location.pathname === path || location.pathname.startsWith(`${path}/`);
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            title={label}
            aria-label={label}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60"
            )}
          >
            <Icon className="w-4 h-4" strokeWidth={isActive ? 2.5 : 2} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};
