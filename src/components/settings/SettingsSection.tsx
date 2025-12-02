import { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
}

export const SettingsSection = ({ title, children }: SettingsSectionProps) => {
  return (
    <div className="mb-8">
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
};
