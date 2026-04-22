import { useEffect, useState, useCallback } from "react";
import { MessageSquare, RefreshCw, ExternalLink } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { disconnectIntegration } from "@/services/integrationConnectionService";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export default function SlackDetail() {
  const { user, authLoading } = useAuth();
  const { getIntegration, setStatus, setApiKeyConfigured, setLastSync } = useIntegrationsStore();
  const integration = getIntegration("slack");
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<{ team_name?: string; team_id?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const hydrate = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from("integration_connections")
        .select("status, metadata, last_validated_at")
        .eq("user_id", user.id)
        .eq("provider", "slack")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status === "connected") {
        const meta = (data.metadata || {}) as { team_name?: string; team_id?: string };
        setWorkspace({ team_name: meta.team_name, team_id: meta.team_id });
        setStatus("slack", "connected");
        setApiKeyConfigured("slack", true);
        if (data.last_validated_at) setLastSync("slack", data.last_validated_at);
      } else {
        setWorkspace(null);
        setStatus("slack", "disconnected");
        setApiKeyConfigured("slack", false);
      }
    } finally {
      setLoading(false);
    }
  }, [user, setStatus, setApiKeyConfigured, setLastSync]);

  useEffect(() => {
    if (authLoading) return;
    void hydrate();
  }, [authLoading, hydrate]);

  // Re-hydrate on focus (e.g. after returning from Slack OAuth)
  useEffect(() => {
    const onFocus = () => { void hydrate(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [hydrate]);

  const handleConnect = () => {
    if (!user) {
      toast.error("Please sign in first");
      return;
    }
    const url = `${SUPABASE_URL}/functions/v1/slack-oauth?action=install&user_id=${encodeURIComponent(user.id)}`;
    window.location.href = url;
  };

  const handleDisconnect = async () => {
    await disconnectIntegration("slack");
    setWorkspace(null);
    setStatus("slack", "disconnected");
    setApiKeyConfigured("slack", false);
    toast.success("Slack disconnected");
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("slack", {
        body: { action: "list_channels", params: { limit: 5 } },
      });
      if (error) throw new Error(error.message);
      if ((data as { success?: boolean })?.success === false) {
        throw new Error((data as { error?: string }).error || "Test failed");
      }
      toast.success("Slack connection works");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const isConnected = integration.status === "connected" && !!workspace;

  if (loading || authLoading) {
    return (
      <IntegrationDetailLayout
        name="Slack"
        description="AI assistant inside your Slack workspace"
        icon={MessageSquare}
        status={integration.status}
      >
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </IntegrationDetailLayout>
    );
  }

  return (
    <IntegrationDetailLayout
      name="Slack"
      description="AI assistant inside your Slack workspace"
      icon={MessageSquare}
      status={integration.status}
      actions={
        isConnected ? (
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
          >
            Add to Slack <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )
      }
    >
      {isConnected ? (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60">
            <div className="text-xs text-muted-foreground mb-1">Connected workspace</div>
            <div className="text-base font-medium text-foreground">
              {workspace?.team_name || "Unknown"}
            </div>
            {workspace?.team_id && (
              <div className="text-xs text-muted-foreground mt-1 font-mono">{workspace.team_id}</div>
            )}
          </div>

          <button
            onClick={handleTest}
            disabled={testing}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-muted/60 text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>

          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-2">
            <div className="text-sm font-medium text-foreground">How to use</div>
            <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
              <li>DM the Ozlon bot inside Slack to chat 1:1.</li>
              <li>@-mention the bot in any channel it's been invited to.</li>
              <li>Reply in any thread the bot has already participated in — it will continue the conversation.</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-2">
            <div className="text-sm font-medium text-foreground">Connect your Slack workspace</div>
            <p className="text-xs text-muted-foreground">
              Click <span className="font-medium text-foreground">Add to Slack</span> to authorize Ozlon
              for your workspace. Each user installs the app for their own workspace — your token is
              stored privately and used only when you DM or @-mention the bot.
            </p>
          </div>
        </div>
      )}
    </IntegrationDetailLayout>
  );
}
