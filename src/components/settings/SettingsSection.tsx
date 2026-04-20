import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
  grouped?: boolean;
}

export const SettingsSection = ({ title, children, grouped = true }: SettingsSectionProps) => {
  return (
    <div className="mb-10">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span
          aria-hidden
          className="w-5 h-0.5 rounded-full bg-gradient-to-r from-primary/60 to-primary/10"
        />
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.15em]">
          {title}
        </h2>
      </div>
      <div
        className={cn(
          "space-y-2",
          grouped && "p-2 rounded-2xl bg-card/30 border border-border/20",
        )}
      >
        {children}
      </div>
    </div>
  );
};
