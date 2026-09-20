import React from "react";
import { ChatComposer } from "./ChatComposer";
import { QuickActionsBar, QuickAction } from "./QuickActionsBar";
import { ContinueCard } from "./ContinueCard";
import { UserSettings } from "@/services/chatService";
import { ConversationSession } from "@/hooks/useConversations";

interface ChatHeroProps {
  systemName: string;
  composerProps: Omit<React.ComponentProps<typeof ChatComposer>, "mode">;
  onQuickAction: (action: QuickAction) => void;
  userSettings: UserSettings;
  disabled: boolean;
  recentSession?: ConversationSession | null;
  onContinueSession?: (id: string) => void;
}


export const ChatHero = ({
  systemName,
  composerProps,
  onQuickAction,
  userSettings,
  disabled,
  recentSession,
  onContinueSession,
}: ChatHeroProps) => {
  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-start px-4 pb-24 pt-[calc(7rem+env(safe-area-inset-top))] md:justify-center md:py-0">
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

      {recentSession && onContinueSession && (
        <ContinueCard session={recentSession} onContinue={onContinueSession} />
      )}
    </div>
  );
};
