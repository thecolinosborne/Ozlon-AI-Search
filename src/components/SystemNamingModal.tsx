import { useState } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface SystemNamingModalProps {
  isOpen: boolean;
  onComplete: (systemName: string) => void;
  userId: string;
}

export const SystemNamingModal = ({ isOpen, onComplete, userId }: SystemNamingModalProps) => {
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const systemName = name.trim() || "Ozlon";
    setIsLoading(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ system_name: systemName })
        .eq("user_id", userId);

      if (error) throw error;
      toast.success(`Welcome to ${systemName}!`);
      onComplete(systemName);
    } catch (error: any) {
      toast.error("Failed to save name");
      onComplete("Ozlon");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = async () => {
    setIsLoading(true);
    try {
      await supabase
        .from("profiles")
        .update({ system_name: "Ozlon" })
        .eq("user_id", userId);
    } catch {
      // Ignore errors for skip
    }
    toast.success("Welcome to Ozlon!");
    onComplete("Ozlon");
    setIsLoading(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-2xl font-light text-center">
            Welcome to Your Personal OS
          </DialogTitle>
          <DialogDescription className="text-center text-base">
            Give your system a name. This is how it will introduce itself to you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ozlon"
              maxLength={30}
              className={cn(
                "w-full px-4 py-4 text-center text-xl rounded-xl border border-neutral-200",
                "focus:outline-none focus:border-neutral-400",
                "placeholder:text-neutral-300"
              )}
              autoFocus
            />
            <p className="text-sm text-neutral-400 text-center mt-3">
              Leave blank to keep the default name "Ozlon"
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSkip}
              disabled={isLoading}
              className={cn(
                "flex-1 py-3 rounded-full font-medium",
                "border border-neutral-200 text-neutral-600",
                "hover:bg-neutral-50 transition-colors",
                "disabled:opacity-50"
              )}
            >
              Keep Ozlon
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                "flex-1 py-3 rounded-full font-medium",
                "bg-neutral-900 text-white",
                "hover:bg-neutral-800 transition-colors",
                "disabled:opacity-50"
              )}
            >
              {isLoading ? "Setting up..." : "Name it"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
