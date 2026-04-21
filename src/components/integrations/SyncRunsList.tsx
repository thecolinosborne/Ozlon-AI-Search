import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Clock, Loader2, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SyncRun {
  id: string;
  status: string;
  sync_type: string;
  direction: string;
  started_at: string | null;
  completed_at: string | null;
  records_processed: number;
  error_message: string | null;
  created_at: string;
}

interface Props {
  connectionId: string | null | undefined;
  refreshKey?: number;
}

const statusStyle = (status: string) => {
  if (status === "succeeded") return { icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400" };
  if (status === "failed") return { icon: XCircle, color: "text-destructive" };
  if (status === "running" || status === "queued") return { icon: Loader2, color: "text-primary animate-spin" };
  return { icon: Clock, color: "text-muted-foreground" };
};

const formatDuration = (start: string | null, end: string | null) => {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
};

export const SyncRunsList = ({ connectionId, refreshKey = 0 }: Props) => {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from("integration_sync_runs")
      .select("id, status, sync_type, direction, started_at, completed_at, records_processed, error_message, created_at")
      .eq("connection_id", connectionId)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (cancelled) return;
        setRuns((data as SyncRun[]) || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [connectionId, refreshKey]);

  if (!connectionId) return null;

  return (
    <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
        <h3 className="text-sm font-medium text-foreground">Recent Sync Runs</h3>
      </div>
      {loading && runs.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">No sync runs yet. Click "Sync Now" to start.</p>
      ) : (
        <ul className="space-y-1.5">
          {runs.map((run) => {
            const { icon: Icon, color } = statusStyle(run.status);
            const duration = formatDuration(run.started_at, run.completed_at);
            return (
              <li key={run.id} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg hover:bg-muted/30">
                <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                <span className="font-medium text-foreground capitalize">{run.status}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{run.records_processed} records</span>
                {duration && (<><span className="text-muted-foreground">·</span><span className="text-muted-foreground">{duration}</span></>)}
                <span className="ml-auto text-muted-foreground/60 text-[10px]">
                  {new Date(run.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
