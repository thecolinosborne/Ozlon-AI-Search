export const AIThinkingIndicator = () => {
  return (
    <div className="flex justify-start animate-fade-in px-6">
      <div className="bg-background/40 backdrop-blur-md px-8 py-6 rounded-3xl border border-border/20 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-16 h-1 bg-gradient-to-r from-primary/20 via-primary to-primary/20 rounded-full animate-pulse" 
               style={{ 
                 animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite, shimmer 2s ease-in-out infinite'
               }} />
        </div>
      </div>
    </div>
  );
};
