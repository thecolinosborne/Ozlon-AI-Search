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
  onClose: (systemName: string) => void;
  userId: string;
}

export const SystemNamingModal = ({ isOpen, onClose, userId }: SystemNamingModalProps) => {
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
      toast.success(`Your system is now called ${systemName}`);
      onClose(systemName);
    } catch (error: any) {
      toast.error("Failed to save name");
      onClose("Ozlon");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    onClose("Ozlon");
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-xl font-light text-center">
            Name Your System
          </DialogTitle>
          <DialogDescription className="text-center">
            Give your personal operating system a name. This is how it will introduce itself to you.
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
                "w-full px-4 py-3 text-center text-lg rounded-lg border border-neutral-200",
                "focus:outline-none focus:border-neutral-400",
                "placeholder:text-neutral-300"
              )}
              autoFocus
            />
            <p className="text-xs text-neutral-400 text-center mt-2">
              Leave blank to keep "Ozlon"
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
              Skip
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
              {isLoading ? "Saving..." : "Confirm"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
