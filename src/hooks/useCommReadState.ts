import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Patch = {
  read_at?: string | null;
  snoozed_until?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
};

export function useCommReadState() {
  const { user } = useAuth();

  const upsert = useCallback(
    async (messageKey: string, patch: Patch) => {
      if (!user?.id) return;
      const row = {
        user_id: user.id,
        message_key: messageKey,
        ...patch,
      };
      const { error } = await supabase
        .from("communications_read_state")
        .upsert(row, { onConflict: "user_id,message_key" });
      if (error) console.warn("[read-state] upsert failed", error.message);
    },
    [user?.id],
  );

  return {
    markDone: (id: string) => upsert(id, { archived_at: new Date().toISOString(), read_at: new Date().toISOString() }),
    markRead: (id: string) => upsert(id, { read_at: new Date().toISOString() }),
    snooze: (id: string, untilMs: number) =>
      upsert(id, { snoozed_until: new Date(untilMs).toISOString() }),
    softDelete: (id: string) => upsert(id, { deleted_at: new Date().toISOString() }),
    restore: (id: string) =>
      upsert(id, { deleted_at: null, archived_at: null, snoozed_until: null }),
  };
}
