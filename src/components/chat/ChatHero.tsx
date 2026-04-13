import React from "react";
import { ChatComposer } from "./ChatComposer";
import { QuickActionsBar, QuickAction } from "./QuickActionsBar";
import { UserSettings } from "@/services/chatService";

interface ChatHeroProps {
  systemName: string;
  composerProps: Omit<React.ComponentProps<typeof ChatComposer>, "mode">;
  onQuickAction: (action: QuickAction) => void;
  userSettings: UserSettings;
  disabled: boolean;
}

export const ChatHero = ({
  systemName,
  composerProps,
  onQuickAction,
  userSettings,
  disabled,
}: ChatHeroProps) => {
  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh]">
      <h1 className="font-light tracking-tight text-neutral-800 text-6xl md:text-7xl mb-2">
        {systemName}
      </h1>
      <p className="text-neutral-500 text-base md:text-lg mb-8">
        Your Personal Operating System
      </p>

      <ChatComposer {...composerProps} mode="hero" />

      <QuickActionsBar
        onAction={onQuickAction}
        disabled={disabled}
        variant="hero"
        userSettings={userSettings}
      />
    </div>
  );
};
