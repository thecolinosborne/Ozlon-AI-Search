export const AIOrb = () => {
  return (
    <div className="relative w-10 h-10 flex-shrink-0">
      <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse" />
      <div className="absolute inset-1 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: "0.5s" }} />
      <div className="absolute inset-2 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: "1s" }} />
      <div className="absolute inset-3 rounded-full bg-primary" />
    </div>
  );
};
