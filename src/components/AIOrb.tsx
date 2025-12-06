import { cn } from "@/lib/utils";

interface AIOrbProps {
  breatheIn?: boolean;
  isSpeaking?: boolean;
  size?: "sm" | "md" | "lg";
}

export const AIOrb = ({ breatheIn = false, isSpeaking = false, size = "md" }: AIOrbProps) => {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-20 h-20",
  };

  const innerSizes = {
    sm: { ring1: "inset-0.5", ring2: "inset-1", core: "inset-1.5" },
    md: { ring1: "inset-1", ring2: "inset-2", core: "inset-3" },
    lg: { ring1: "inset-2", ring2: "inset-4", core: "inset-6" },
  };

  return (
    <div className={cn(
      "relative flex-shrink-0",
      sizeClasses[size],
      breatheIn && "animate-breath-in"
    )}>
      {/* Ripple effect - enhanced when speaking */}
      <div className={cn(
        "absolute inset-0 rounded-full bg-primary/20",
        isSpeaking ? "animate-pulse-ring" : "animate-ripple"
      )} />
      
      {/* Additional speaking rings */}
      {isSpeaking && (
        <>
          <div className="absolute -inset-2 rounded-full bg-primary/10 animate-ping" style={{ animationDuration: "1.5s" }} />
          <div className="absolute -inset-4 rounded-full bg-primary/5 animate-ping" style={{ animationDuration: "2s", animationDelay: "0.5s" }} />
        </>
      )}
      
      {/* Breathing layers */}
      <div className={cn(
        "absolute rounded-full bg-primary/30",
        innerSizes[size].ring1,
        isSpeaking ? "animate-pulse" : "animate-breathe"
      )} style={{ animationDuration: isSpeaking ? "0.8s" : "4s" }} />
      <div className={cn(
        "absolute rounded-full bg-primary/50",
        innerSizes[size].ring2,
        isSpeaking ? "animate-pulse" : "animate-breathe"
      )} style={{ animationDelay: "0.5s", animationDuration: isSpeaking ? "0.8s" : "4s" }} />
      
      {/* Core - glows more intensely when speaking */}
      <div 
        className={cn(
          "absolute rounded-full bg-primary transition-all duration-300",
          innerSizes[size].core,
          isSpeaking && "scale-110"
        )} 
        style={{ 
          boxShadow: isSpeaking 
            ? "0 0 30px hsl(var(--primary)), 0 0 60px hsl(var(--primary) / 0.5)" 
            : "var(--orb-glow)" 
        }} 
      />
    </div>
  );
};
