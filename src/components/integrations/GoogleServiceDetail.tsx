import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { LucideIcon, Shield, Loader2, CheckCircle2, XCircle, ExternalLink, Settings2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { isServiceGranted, getGoogleServiceConfig } from "@/lib/googleScopes";

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
  const scopeCfg = getGoogleServiceConfig(config.serviceId);

  const [oauthRowExists, setOauthRowExists] = useState(false);
  const [oauthDetail, setOauthDetail] = useState<OAuthDetail>("unknown");
  const [grantedScopes, setGrantedScopes] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: "ok" | "error"; message: string } | null>(null);

  const loadedRef = useRef(false);

  const serviceGranted = isServiceGranted(config.serviceId, grantedScopes);
  const accountAuthorized =
    oauthDetail === "connected" || oauthDetail === "refreshed";

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
      const result = await callYouTube("get_connection") as {
        oauthStatus?: OAuthDetail;
        grantedScopes?: string;
      };
      const oauthStatus = result.oauthStatus || "disconnected";
      setOauthDetail(oauthStatus);
      const exists = oauthStatus === "connected" || oauthStatus === "refreshed";
      setOauthRowExists(exists);
      const scopes = result.grantedScopes || "";
      setGrantedScopes(scopes);
      const granted = exists && isServiceGranted(config.serviceId, scopes);
      setStatus(config.serviceId, granted ? "connected" : "disconnected");
    } catch {
      setOauthRowExists(false);
      setGrantedScopes("");
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
      status={serviceGranted ? "connected" : integration.status === "connected" ? "disconnected" : integration.status}
    >
      {/* Google Cloud setup guide */}
      {scopeCfg && (
        <section className="rounded-2xl border border-border/40 bg-card/80 backdrop-blur-sm p-5 space-y-4">
          <div className="flex items-start gap-3">
            <Settings2 className="w-5 h-5 text-primary mt-0.5" strokeWidth={1.5} />
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-foreground">Google Cloud setup</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Before authorizing, enable <span className="font-medium text-foreground">{scopeCfg.apiName}</span> in your Google Cloud project. The same OAuth client authorizes all Google services — but each API must be enabled individually in Cloud.
              </p>
              <p className="text-xs text-muted-foreground/80 mt-2">
                <span className="font-medium text-foreground/90">What you're authorizing:</span> {scopeCfg.scopeSummary}.
              </p>
            </div>
          </div>
          <a
            href={scopeCfg.cloudConsoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border/60 bg-background hover:bg-muted/40 transition-colors"
          >
            Enable {scopeCfg.apiName} in Google Cloud
            <ExternalLink className="w-3 h-3" />
          </a>
        </section>
      )}

      {/* OAuth status card */}
      <section className="rounded-2xl border border-border/40 bg-card/80 backdrop-blur-sm p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-primary mt-0.5" strokeWidth={1.5} />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">Authorization for {config.name}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Uses your shared Google Workspace OAuth. Authorizing {config.name} here will re-prompt Google's consent screen with the scopes for all enabled Google services.
            </p>
            {config.scopeNote && (
              <p className="text-xs text-muted-foreground/80 mt-2 italic">{config.scopeNote}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3 gap-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Checking authorization…</span>
              </>
            ) : serviceGranted ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="text-foreground truncate">Authorized for {config.name}</span>
              </>
            ) : accountAuthorized ? (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-foreground truncate">Google account linked — but {config.name} scope not granted</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Not authorized</span>
              </>
            )}
          </div>
          <button
            onClick={handleAuthorize}
            disabled={authorizing}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
          >
            {authorizing
              ? "Redirecting…"
              : serviceGranted
              ? `Re-authorize ${config.name}`
              : `Authorize ${config.name}`}
          </button>
        </div>

        {!loading && oauthRowExists && !serviceGranted && (
          <p className="text-[11px] text-muted-foreground">
            Tip: when Google's consent screen appears, make sure the {config.name} permission is checked before continuing.
          </p>
        )}
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
          disabled={testing || !serviceGranted}
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
