import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface OnboardingLayoutProps {
  children: ReactNode;
  showProgress?: boolean;
  progress?: number;
  step?: number;
  totalSteps?: number;
}

export const OnboardingLayout = ({
  children,
  showProgress = true,
  progress = 0,
  step = 1,
  totalSteps = 8,
}: OnboardingLayoutProps) => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/10 flex flex-col px-6 safe-area-top safe-area-bottom">
      {/* Progress bar */}
      {showProgress && (
        <div className="pt-8 pb-2">
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-700 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center font-medium">
            {step} of {totalSteps}
          </p>
        </div>
      )}

      {/* Content */}
      <div className={cn(
        "flex-1 flex items-center justify-center py-8",
        !showProgress && "pt-16"
      )}>
        <div className="w-full max-w-md animate-fade-in">
          {children}
        </div>
      </div>
    </div>
  );
};
