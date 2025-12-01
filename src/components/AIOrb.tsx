interface AIOrbProps {
  breatheIn?: boolean;
}

export const AIOrb = ({ breatheIn = false }: AIOrbProps) => {
  return (
    <div className={`relative w-12 h-12 flex-shrink-0 ${breatheIn ? 'animate-breath-in' : ''}`}>
      {/* Ripple effect */}
      <div className="absolute inset-0 rounded-full bg-primary/20 animate-ripple" />
      {/* Breathing layers */}
      <div className="absolute inset-0 rounded-full bg-primary/30 animate-breathe" />
      <div className="absolute inset-1 rounded-full bg-primary/50 animate-breathe" style={{ animationDelay: "0.5s" }} />
      <div className="absolute inset-2 rounded-full bg-primary/70 animate-breathe" style={{ animationDelay: "1s" }} />
      {/* Core */}
      <div className="absolute inset-3 rounded-full bg-primary" style={{ boxShadow: "var(--orb-glow)" }} />
    </div>
  );
};
