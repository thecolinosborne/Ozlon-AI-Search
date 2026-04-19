import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BottomNav } from "@/components/navigation/BottomNav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Play, Trash2, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface Routine {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  cron_expression: string;
  delivery_channel: string;
  active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  run_count: number;
  created_at: string;
}

interface RoutineRun {
  id: string;
  routine_id: string;
  status: string;
  output: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

const CRON_PRESETS = [
  { label: "Every day at 7am EST", value: "0 12 * * *" },
  { label: "Every day at 8am EST", value: "0 13 * * *" },
  { label: "Every day at 9am EST", value: "0 14 * * *" },
  { label: "Every Monday at 8am EST", value: "0 13 * * 1" },
  { label: "Every Friday at 4pm EST", value: "0 21 * * 5" },
  { label: "First of month at 8am EST", value: "0 13 1 * *" },
  { label: "Custom", value: "custom" },
];

export default function Routines() {
  const { user } = useAuth();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRunRoutine, setSelectedRunRoutine] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cronPreset, setCronPreset] = useState("0 12 * * *");
  const [customCron, setCustomCron] = useState("");
  const [channel, setChannel] = useState("in_app");

  const fetchRoutines = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("scheduled_routines")
      .select("*")
      .order("created_at", { ascending: false });
    setRoutines((data as Routine[]) ?? []);
    setLoading(false);
  };

  const fetchRuns = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("routine_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    setRuns((data as RoutineRun[]) ?? []);
  };

  useEffect(() => {
    fetchRoutines();
    fetchRuns();
    const interval = setInterval(() => {
      fetchRoutines();
      fetchRuns();
    }, 15000);
    return () => clearInterval(interval);
  }, [user]);

  const handleCreate = async () => {
    if (!user) return;
    if (!name.trim() || !prompt.trim()) {
      toast.error("Name and prompt are required");
      return;
    }
    const cron = cronPreset === "custom" ? customCron : cronPreset;
    if (!cron.trim()) {
      toast.error("Cron expression is required");
      return;
    }
    const { error } = await supabase.from("scheduled_routines").insert({
      user_id: user.id,
      name: name.trim(),
      description: description.trim() || null,
      prompt: prompt.trim(),
      cron_expression: cron.trim(),
      delivery_channel: channel,
      active: true,
    });
    if (error) {
      toast.error(`Failed: ${error.message}`);
      return;
    }
    toast.success("Routine created");
    setCreateOpen(false);
    setName("");
    setDescription("");
    setPrompt("");
    setCustomCron("");
    fetchRoutines();
  };

  const handleToggle = async (id: string, active: boolean) => {
    await supabase.from("scheduled_routines").update({ active }).eq("id", id);
    fetchRoutines();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this routine? This cannot be undone.")) return;
    await supabase.from("scheduled_routines").delete().eq("id", id);
    toast.success("Routine deleted");
    fetchRoutines();
  };

  const handleRunNow = async (id: string) => {
    toast.info("Running routine...");
    const { data, error } = await supabase.functions.invoke("scheduled-routines", {
      body: { routine_id: id },
    });
    if (error) {
      toast.error(`Run failed: ${error.message}`);
      return;
    }
    if (data?.success) {
      toast.success("Routine completed");
    } else {
      toast.error(`Routine failed: ${data?.error ?? "unknown"}`);
    }
    fetchRoutines();
    fetchRuns();
  };

  const filteredRuns = selectedRunRoutine
    ? runs.filter((r) => r.routine_id === selectedRunRoutine)
    : runs;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Routines</h1>
            <p className="text-xs text-muted-foreground">Recurring AI workflows that run on their own</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-1" />
                New
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Routine</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    placeholder="Morning Brief"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description (optional)</Label>
                  <Input
                    placeholder="Daily morning summary"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Prompt</Label>
                  <Textarea
                    rows={5}
                    placeholder="Scan unread Gmail, fetch today's Calendar, get top 3 industry headlines via Tavily, summarize into a clean morning brief."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The AI will execute this with all tools enabled.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Schedule</Label>
                  <Select value={cronPreset} onValueChange={setCronPreset}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CRON_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {cronPreset === "custom" && (
                    <Input
                      placeholder="0 12 * * * (UTC, 5-field cron)"
                      value={customCron}
                      onChange={(e) => setCustomCron(e.target.value)}
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Delivery</Label>
                  <Select value={channel} onValueChange={setChannel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_app">In-app (this page)</SelectItem>
                      <SelectItem value="gmail">Email via Gmail</SelectItem>
                      <SelectItem value="doc">Google Doc + email link</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Gmail/Doc delivery requires the AI to use those tools in your prompt.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Routines list */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Active Routines
          </h2>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : routines.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No routines yet.</p>
              <p className="text-xs mt-1">
                Tap "New" or tell the assistant: <em>"Every morning at 7am, brief me on my unread email and calendar."</em>
              </p>
            </Card>
          ) : (
            routines.map((r) => (
              <Card
                key={r.id}
                className={`p-4 cursor-pointer transition-colors ${selectedRunRoutine === r.id ? "ring-2 ring-primary" : ""}`}
                onClick={() => setSelectedRunRoutine(selectedRunRoutine === r.id ? null : r.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium truncate">{r.name}</h3>
                      {!r.active && <Badge variant="secondary" className="text-xs">Paused</Badge>}
                      {r.last_run_status === "failed" && (
                        <Badge variant="destructive" className="text-xs">Last run failed</Badge>
                      )}
                    </div>
                    {r.description && (
                      <p className="text-xs text-muted-foreground mb-1">{r.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground font-mono">{r.cron_expression} UTC</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Runs: {r.run_count}
                      {r.last_run_at &&
                        ` · Last: ${formatDistanceToNow(new Date(r.last_run_at), { addSuffix: true })}`}
                    </p>
                  </div>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={r.active}
                      onCheckedChange={(v) => handleToggle(r.id, v)}
                    />
                    <Button size="icon" variant="ghost" onClick={() => handleRunNow(r.id)}>
                      <Play className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(r.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </section>

        {/* Recent runs */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {selectedRunRoutine ? "Runs for selected routine" : "Recent Runs"}
            </h2>
            {selectedRunRoutine && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedRunRoutine(null)}>
                Show all
              </Button>
            )}
          </div>
          {filteredRuns.length === 0 ? (
            <Card className="p-6 text-center text-xs text-muted-foreground">
              No runs yet.
            </Card>
          ) : (
            filteredRuns.slice(0, 20).map((run) => {
              const routine = routines.find((r) => r.id === run.routine_id);
              return (
                <Card key={run.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {run.status === "completed" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : run.status === "failed" ? (
                        <XCircle className="w-4 h-4 text-destructive" />
                      ) : (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">{routine?.name ?? "Routine"}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                    </span>
                  </div>
                  {run.error_message && (
                    <p className="text-xs text-destructive mb-2">{run.error_message}</p>
                  )}
                  {run.output && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer hover:text-foreground">
                        View output ({run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"})
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-foreground/80 bg-muted/30 rounded p-2 max-h-96 overflow-auto">
                        {run.output}
                      </pre>
                    </details>
                  )}
                </Card>
              );
            })
          )}
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
