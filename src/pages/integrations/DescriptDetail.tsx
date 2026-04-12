import { useState, useEffect } from "react";
import { Video, Play, Upload, ExternalLink, RefreshCw, X, Info, Loader2, AlertCircle } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface DescriptJob {
  job_id: string;
  job_type: string;
  status: string;
  input_prompt?: string;
  created_at?: string;
  error_message?: string;
}

const DescriptDetail = () => {
  const { getIntegration, setStatus, setSyncDirection, setLastSync, setApiKeyConfigured } = useIntegrationsStore();
  const integration = getIntegration("descript");

  const [autoDetecting, setAutoDetecting] = useState(true);
  const [testing, setTesting] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [importingMedia, setImportingMedia] = useState(false);
  const [editProjectId, setEditProjectId] = useState("");
  const [editIntent, setEditIntent] = useState("");
  const [runningEdit, setRunningEdit] = useState(false);
  const [checkJobId, setCheckJobId] = useState("");
  const [checkingJob, setCheckingJob] = useState(false);
  const [jobResult, setJobResult] = useState<Record<string, unknown> | null>(null);
  const [recentJobs, setRecentJobs] = useState<DescriptJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const callDescript = async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("descript", {
      body: { action, ...params },
    });
    if (error) throw new Error(error.message);
    return data;
  };

  // Auto-detect backend API key on mount
  useEffect(() => {
    let cancelled = false;
    const detectKey = async () => {
      setAutoDetecting(true);
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/descript`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ action: "test_connection" }),
        });
        if (cancelled) return;
        if (res.ok) {
          const result = await res.json();
          if (result?.success) {
            setStatus("descript", "connected");
            setApiKeyConfigured("descript", true);
            setLastSync("descript", new Date().toISOString());
          } else {
            setStatus("descript", "disconnected");
            setApiKeyConfigured("descript", false);
          }
        } else {
          setStatus("descript", "disconnected");
          setApiKeyConfigured("descript", false);
        }
      } catch (e) {
        console.error("Descript auto-detect failed:", e);
        if (!cancelled) {
          setStatus("descript", "disconnected");
          setApiKeyConfigured("descript", false);
        }
      } finally {
        if (!cancelled) setAutoDetecting(false);
      }
    };
    detectKey();
    return () => { cancelled = true; };
  }, []);

  const handleDisconnect = () => {
    setStatus("descript", "disconnected");
    setApiKeyConfigured("descript", false);
    toast.success("Descript disconnected");
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await callDescript("test_connection");
      toast.success("Descript connection verified");
      setLastSync("descript", new Date().toISOString());
    } catch (e: unknown) {
      toast.error(`Connection failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setTesting(false);
    }
  };

  const handleImportMedia = async () => {
    if (!mediaUrl.trim()) return;
    setImportingMedia(true);
    try {
      const result = await callDescript("import_media", { media_url: mediaUrl.trim() });
      toast.success(`Media import started — Job: ${result.job_id}`);
      setMediaUrl("");
      setJobResult(result);
    } catch (e: unknown) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setImportingMedia(false);
    }
  };

  const handleRunEdit = async () => {
    if (!editProjectId.trim() || !editIntent.trim()) return;
    setRunningEdit(true);
    try {
      const result = await callDescript("run_agent_edit", {
        project_id: editProjectId.trim(),
        user_intent: editIntent.trim(),
      });
      toast.success(`AI edit started — Prompt: "${result.prompt_used}"`);
      setEditProjectId("");
      setEditIntent("");
      setJobResult(result);
    } catch (e: unknown) {
      toast.error(`Edit failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setRunningEdit(false);
    }
  };

  const handleCheckJob = async () => {
    if (!checkJobId.trim()) return;
    setCheckingJob(true);
    try {
      const result = await callDescript("get_job_status", { job_id: checkJobId.trim() });
      setJobResult(result);
      toast.success(`Job status: ${result.data?.state || result.data?.status || "fetched"}`);
    } catch (e: unknown) {
      toast.error(`Status check failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setCheckingJob(false);
    }
  };

  const handleListJobs = async () => {
    setLoadingJobs(true);
    try {
      const result = await callDescript("list_jobs");
      const jobs = Array.isArray(result.data) ? result.data : result.data?.jobs || [];
      setRecentJobs(jobs.slice(0, 10));
      toast.success(`Fetched ${jobs.length} jobs`);
    } catch (e: unknown) {
      toast.error(`Failed to fetch jobs: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setLoadingJobs(false);
    }
  };

  const inputClass = cn(
    "w-full px-3 py-2 rounded-xl border border-border bg-background text-sm",
    "focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
  );

  const actionBtnClass = cn(
    "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
    "bg-primary text-primary-foreground hover:bg-primary/90",
    "disabled:opacity-50 disabled:cursor-not-allowed"
  );

  const secondaryBtnClass = cn(
    "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
    "border border-border hover:bg-muted/60 text-foreground"
  );

  return (
    <IntegrationDetailLayout
      name="Descript"
      description="AI-powered video & podcast editing engine"
      icon={Video}
      status={integration.status}
      actions={
        integration.status === "connected" ? (
          <button onClick={handleDisconnect} className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
            Disconnect
          </button>
        ) : undefined
      }
    >
      {autoDetecting && (
        <div className="p-4 rounded-2xl border border-border/40 bg-card/60 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Detecting backend API key…</p>
        </div>
      )}

      {!autoDetecting && integration.status === "disconnected" && (
        <div className="p-4 rounded-2xl border border-destructive/30 bg-destructive/5 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-destructive" />
          <p className="text-sm text-destructive">Backend API key not configured. Add <code className="font-mono text-xs">DESCRIPT_API_KEY</code> as a backend secret.</p>
        </div>
      )}

      {integration.status === "connected" && (
        <>
          {/* Test Connection */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Connection</h3>
            <div className="flex gap-2">
              <button onClick={handleTestConnection} disabled={testing} className={actionBtnClass}>
                {testing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                Test Connection
              </button>
              <button onClick={handleListJobs} disabled={loadingJobs} className={secondaryBtnClass}>
                {loadingJobs ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <RefreshCw className="w-4 h-4 inline mr-1" />}
                Fetch Jobs
              </button>
            </div>
          </div>

          <SyncControl
            direction={integration.syncDirection}
            onDirectionChange={(d) => setSyncDirection("descript", d)}
            lastSync={integration.lastSync}
          />

          {/* Import Media */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="text-sm font-medium text-foreground">Import Media</h3>
            </div>
            <input type="text" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://example.com/video.mp4" className={inputClass} />
            <button onClick={handleImportMedia} disabled={!mediaUrl.trim() || importingMedia} className={actionBtnClass}>
              {importingMedia ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
              Import
            </button>
          </div>

          {/* Run AI Edit */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <div className="flex items-center gap-2">
              <Play className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="text-sm font-medium text-foreground">Run AI Edit</h3>
            </div>
            <input type="text" value={editProjectId} onChange={(e) => setEditProjectId(e.target.value)} placeholder="Descript Project ID" className={inputClass} />
            <input type="text" value={editIntent} onChange={(e) => setEditIntent(e.target.value)} placeholder='e.g. "make this podcast better"' className={inputClass} />
            <p className="text-[11px] text-muted-foreground">Your intent is automatically translated into an optimized Descript prompt.</p>
            <button onClick={handleRunEdit} disabled={!editProjectId.trim() || !editIntent.trim() || runningEdit} className={actionBtnClass}>
              {runningEdit ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
              Run Edit
            </button>
          </div>

          {/* Check Job Status */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="text-sm font-medium text-foreground">Check Job Status</h3>
            </div>
            <input type="text" value={checkJobId} onChange={(e) => setCheckJobId(e.target.value)} placeholder="Job ID" className={inputClass} />
            <button onClick={handleCheckJob} disabled={!checkJobId.trim() || checkingJob} className={actionBtnClass}>
              {checkingJob ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
              Check Status
            </button>
          </div>

          {/* Job Result */}
          {jobResult && (
            <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Latest Result</h3>
                <button onClick={() => setJobResult(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <pre className="text-xs bg-muted/40 p-3 rounded-xl overflow-auto max-h-60 text-foreground/80">
                {JSON.stringify(jobResult, null, 2)}
              </pre>
            </div>
          )}

          {/* Recent Jobs */}
          {recentJobs.length > 0 && (
            <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
              <h3 className="text-sm font-medium text-foreground">Recent Jobs</h3>
              <div className="space-y-2">
                {recentJobs.map((job, i) => (
                  <div key={job.job_id || i} className="flex items-center justify-between p-3 rounded-xl bg-muted/40">
                    <div>
                      <p className="text-sm font-medium text-foreground">{job.job_type || "job"}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{job.job_id}</p>
                    </div>
                    <span className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full",
                      job.status === "complete" || job.status === "completed"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : job.status === "failed" || job.status === "error"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-primary/10 text-primary"
                    )}>
                      {job.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Handoff */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <div className="flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="text-sm font-medium text-foreground">Open in Descript</h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              For advanced editing not supported by the API, open your project directly in Descript.
            </p>
            <a href="https://web.descript.com" target="_blank" rel="noopener noreferrer" className={secondaryBtnClass + " inline-flex items-center gap-1.5"}>
              <ExternalLink className="w-3.5 h-3.5" />
              Open Descript
            </a>
          </div>

          {/* Capabilities Info */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="text-sm font-medium text-foreground">Capabilities</h3>
            </div>
            <div className="text-[12px] text-muted-foreground space-y-1.5">
              <p>Upload media, run AI-powered editing, and retrieve processed results. Descript handles media processing while your app provides the intelligence.</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Remove filler words</li>
                <li>Enhance audio quality</li>
                <li>Add captions & subtitles</li>
                <li>Create highlight clips</li>
                <li>Generate social media cuts</li>
                <li>Rough cut editing</li>
                <li>Content repurposing</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </IntegrationDetailLayout>
  );
};

export default DescriptDetail;
