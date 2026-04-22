export function EmptyCaughtUp() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/40 to-primary/10 animate-breathe shadow-[var(--ai-message-glow)]" />
      <p className="mt-8 text-base text-foreground font-medium">You're caught up.</p>
      <p className="mt-1 text-sm text-muted-foreground">Take the win.</p>
    </div>
  );
}
