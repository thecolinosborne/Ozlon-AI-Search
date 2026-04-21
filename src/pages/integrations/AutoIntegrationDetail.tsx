/**
 * Generic detail page rendered for any registered integration that doesn't
 * declare `customDetailPage: true`. New integrations get a working detail
 * page just by adding a manifest entry to `src/integrations/registry.ts`.
 */
import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Plug } from "lucide-react";
import { toast } from "sonner";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { getIntegrationManifest } from "@/integrations/registry";

export default function AutoIntegrationDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const manifest = getIntegrationManifest(id);
  const { session } = useAuth();
  const { getIntegration } = useIntegrationsStore();
  const integration = manifest ? getIntegration(manifest.id) : undefined;

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: "ok" | "error"; message: string } | null>(null);

  const handleTest = useCallback(async () => {
    if (!manifest?.fnName || !manifest?.testAction) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke(manifest.fnName, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        body: { action: manifest.testAction, params: {} },
      });
      if (error) throw new Error(error.message);
      const errMsg = (data as { error?: string })?.error;
      if (errMsg) throw new Error(errMsg);
      setTestResult({ status: "ok", message: `${manifest.name} responded successfully` });
      toast.success(`${manifest.name} connection works`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setTestResult({ status: "error", message: msg.slice(0, 200) });
      toast.error(`${manifest.name} test failed`);
    } finally {
      setTesting(false);
    }
  }, [manifest, session?.access_token]);

  if (!manifest) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">Integration not found</h1>
          <p className="text-sm text-muted-foreground">
            No integration is registered for <code className="px-1.5 py-0.5 rounded bg-muted/60 text-xs">{id}</code>.
          </p>
          <button
            onClick={() => navigate("/integrations")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Back to Integrations
          </button>
        </div>
      </div>
    );
  }

  return (
    <IntegrationDetailLayout
      name={manifest.name}
      description={manifest.description}
      icon={manifest.icon}
      status={integration?.status ?? "disconnected"}
    >
      {/* Auth status / instructions */}
      <section className="rounded-2xl border border-border/40 bg-card/80 backdrop-blur-sm p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Plug className="w-5 h-5 text-primary mt-0.5" strokeWidth={1.5} />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">Connection</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {manifest.auth === "google-oauth"
                ? "Authorize via the shared Google Workspace OAuth flow."
                : manifest.auth === "api-key"
                ? "This integration uses an API key. Configure it from the dedicated setup page."
                : "No authorization required."}
            </p>
          </div>
        </div>
      </section>

      {/* Test connection — only when the manifest declares an endpoint */}
      {manifest.fnName && manifest.testAction && (
        <section className="rounded-2xl border border-border/40 bg-card/80 backdrop-blur-sm p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Test connection</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Calls <code className="text-[11px] px-1 py-0.5 rounded bg-muted/60">{manifest.fnName} · {manifest.testAction}</code>.
            </p>
          </div>

          <button
            onClick={handleTest}
            disabled={testing}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-xl border border-border/60 bg-background hover:bg-muted/40 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {testing ? "Testing…" : `Test ${manifest.testLabel || manifest.name}`}
          </button>

          {testResult && (
            <div
              className={cn(
                "rounded-xl px-4 py-3 text-xs flex items-start gap-2",
                testResult.status === "ok"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {testResult.status === "ok" ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              <span className="break-words">{testResult.message}</span>
            </div>
          )}
        </section>
      )}
    </IntegrationDetailLayout>
  );
}
