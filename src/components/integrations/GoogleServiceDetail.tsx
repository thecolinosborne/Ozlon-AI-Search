import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { LucideIcon, Shield, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

export interface GoogleServiceConfig {
  serviceId: string;
  name: string;
  description: string;
  icon: LucideIcon;
  fnName: string;
  testAction: string;
  testLabel?: string;
  scopeNote?: string;
}

type OAuthDetail = "connected" | "refreshed" | "expired" | "refresh_failed" | "expired_no_refresh" | "disconnected" | "unknown";

export function GoogleServiceDetail({ config }: { config: GoogleServiceConfig }) {
  const { session, authLoading } = useAuth();
  const { getIntegration, setStatus } = useIntegrationsStore();
  const integration = getIntegration(config.serviceId);

  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthDetail, setOauthDetail] = useState<OAuthDetail>("unknown");
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: "ok" | "error"; message: string } | null>(null);

  const loadedRef = useRef(false);

  const callYouTube = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("youtube", {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      body: { action, params },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data;
  }, [session?.access_token]);

  const callServiceFn = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke(config.fnName, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      body: { action, params },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data;
  }, [session?.access_token, config.fnName]);

  const loadOAuthStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callYouTube("get_connection");
      const oauthStatus = (result.oauthStatus as OAuthDetail) || "disconnected";
      setOauthDetail(oauthStatus);
      const connected = oauthStatus === "connected" || oauthStatus === "refreshed";
      setOauthConnected(connected);
      setStatus(config.serviceId, connected ? "connected" : "disconnected");
    } catch {
      setOauthConnected(false);
      setStatus(config.serviceId, "disconnected");
    } finally {
      setLoading(false);
    }
  }, [callYouTube, config.serviceId, setStatus]);

  useEffect(() => {
    if (authLoading || !session || loadedRef.current) return;
    loadedRef.current = true;
    loadOAuthStatus();
  }, [authLoading, session, loadOAuthStatus]);

  const handleAuthorize = async () => {
    setAuthorizing(true);
    try {
      const result = await callYouTube("oauth_authorize", {
        redirectUri: `${window.location.origin}/integrations/youtube`,
      });
      window.location.href = (result as { authUrl: string }).authUrl;
    } catch (e) {
      toast.error(`OAuth failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      setAuthorizing(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await callServiceFn(config.testAction);
      setTestResult({ status: "ok", message: `${config.name} responded successfully` });
      toast.success(`${config.name} connection works`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setTestResult({ status: "error", message: msg.slice(0, 200) });
      toast.error(`${config.name} test failed`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <IntegrationDetailLayout
      name={config.name}
      description={config.description}
      icon={config.icon}
      status={integration.status}
    >
      {/* OAuth status card */}
      <section className="rounded-2xl border border-border/40 bg-card/80 backdrop-blur-sm p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-primary mt-0.5" strokeWidth={1.5} />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">Google Workspace OAuth</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {config.name} uses your shared Google Workspace authorization. Connecting once authorizes all Google services.
            </p>
            {config.scopeNote && (
              <p className="text-xs text-muted-foreground/80 mt-2 italic">{config.scopeNote}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Checking authorization…</span>
              </>
            ) : oauthConnected ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-foreground">Authorized ({oauthDetail})</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Not authorized</span>
              </>
            )}
          </div>
          <button
            onClick={handleAuthorize}
            disabled={authorizing}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {authorizing ? "Redirecting…" : oauthConnected ? "Re-authorize" : "Authorize"}
          </button>
        </div>
      </section>

      {/* Test connection */}
      <section className="rounded-2xl border border-border/40 bg-card/80 backdrop-blur-sm p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Test connection</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Calls <code className="text-[11px] px-1 py-0.5 rounded bg-muted/60">{config.fnName} · {config.testAction}</code> with your OAuth token.
          </p>
        </div>

        <button
          onClick={handleTest}
          disabled={testing || !oauthConnected}
          className="w-full text-sm font-medium px-4 py-2.5 rounded-xl border border-border/60 bg-background hover:bg-muted/40 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {testing ? "Testing…" : `Test ${config.testLabel || config.name}`}
        </button>

        {testResult && (
          <div
            className={cn(
              "rounded-xl px-4 py-3 text-xs flex items-start gap-2",
              testResult.status === "ok"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive"
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

      {/* Footer link */}
      <Link
        to="/integrations/youtube"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Manage Google Workspace OAuth
        <ExternalLink className="w-3 h-3" />
      </Link>
    </IntegrationDetailLayout>
  );
}
