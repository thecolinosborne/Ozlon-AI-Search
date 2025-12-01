export const AIThinkingIndicator = () => {
  return (
    <div className="flex justify-start animate-slide-up-fade px-6">
      <div className="bg-background/60 backdrop-blur-md px-10 py-7 rounded-3xl border border-border/30 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-20 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent rounded-full animate-pulse" 
               style={{ 
                 animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite'
               }} />
        </div>
      </div>
    </div>
  );
};
