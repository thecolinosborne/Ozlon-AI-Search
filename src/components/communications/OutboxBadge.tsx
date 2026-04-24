import { useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface OutboxBadgeProps {
  onRetry?: () => void;
}

/**
 * Surfaces queued outbound messages from `communications_outbox`.
 * Polls lazily (15s) — outbox writes are rare so this is plenty.
 */
export function OutboxBadge({ onRetry }: OutboxBadgeProps) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const fetchCount = async () => {
      const { count: c } = await supabase
        .from("communications_outbox")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "queued");
      if (!cancelled) setCount(c ?? 0);
    };
    fetchCount();
    const t = setInterval(fetchCount, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user?.id]);

  if (count === 0) return null;
  return (
    <div className="mx-4 lg:mx-6 my-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-card/60 border border-border/40 backdrop-blur-xl">
      <Send className="w-3.5 h-3.5 text-primary shrink-0" />
      <p className="text-[12px] text-foreground/80 flex-1">
        {count} message{count === 1 ? "" : "s"} queued — will retry on next scan
      </p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          <RefreshCw className="w-3 h-3" />
          Retry now
        </button>
      ) : null}
    </div>
  );
}
