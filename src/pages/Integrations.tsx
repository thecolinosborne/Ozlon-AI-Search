import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Globe, Video, Sparkles, CheckSquare, Youtube } from "lucide-react";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TopNav } from "@/components/navigation/TopNav";

const integrations = [
  {
    id: "gohighlevel",
    name: "Go High Level",
    description: "CRM platform with contacts, pipelines, conversations, and marketing tools.",
    icon: Globe,
    path: "/integrations/gohighlevel",
  },
  {
    id: "descript",
    name: "Descript",
    description: "Video and podcast editing platform. Sync media and content assets.",
    icon: Video,
    path: "/integrations/descript",
  },
  {
    id: "higgsfield",
    name: "Higgsfield AI",
    description: "AI-powered video generation and creative content platform.",
    icon: Sparkles,
    path: "/integrations/higgsfield",
  },
  {
    id: "clickup",
    name: "ClickUp",
    description: "Task management with AI-powered project manager replies inside task comments.",
    icon: CheckSquare,
    path: "/integrations/clickup",
  },
  {
    id: "youtube",
    name: "Google Workspace",
    description: "YouTube, Gmail, Drive, Calendar, Sheets, Docs, Analytics, Search Console — one OAuth.",
    icon: Youtube,
    path: "/integrations/youtube",
  },
];

// Map UI ids to provider names in integration_connections.
const PROVIDER_BY_ID: Record<string, string> = {
  gohighlevel: "gohighlevel",
  descript: "descript",
  higgsfield: "higgsfield",
  clickup: "clickup",
  youtube: "youtube",
};

const Integrations = () => {
  const navigate = useNavigate();
  const { user, authLoading } = useAuth();
  const { getIntegration, setStatus, setApiKeyConfigured, setLastSync, disconnect } = useIntegrationsStore();

  // Hydrate connection status STRICTLY from per-user integration_connections (no env-trusting probes).
  useEffect(() => {
    // Wait until auth has actually resolved — otherwise we race and force-disconnect everything.
    if (authLoading) return;

    let cancelled = false;
    const hydrate = async () => {
      if (!user) {
        // Genuinely signed out — clear everything.
        for (const i of integrations) disconnect(i.id);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("integration_connections")
          .select("provider, status, last_validated_at")
          .eq("user_id", user.id);
        if (cancelled || error) return;
        const byProvider = new Map<string, { status: string; last_validated_at: string | null }>();
        for (const row of data || []) {
          // If multiple rows exist for one provider, prefer the connected one.
          const existing = byProvider.get(row.provider);
          if (!existing || (row.status === "connected" && existing.status !== "connected")) {
            byProvider.set(row.provider, { status: row.status, last_validated_at: row.last_validated_at });
          }
        }
        for (const i of integrations) {
          const provider = PROVIDER_BY_ID[i.id];
          const row = provider ? byProvider.get(provider) : undefined;
          if (row && row.status === "connected") {
            setStatus(i.id, "connected");
            setApiKeyConfigured(i.id, true);
            if (row.last_validated_at) setLastSync(i.id, row.last_validated_at);
          } else {
            disconnect(i.id);
          }
        }
      } catch {
        /* silent */
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, [authLoading, user?.id, setStatus, setApiKeyConfigured, setLastSync, disconnect]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30 px-4 py-3 safe-area-top">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="p-2 hover:bg-muted rounded-full transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Integrations</h1>
              <p className="text-xs text-muted-foreground">Connect and manage your tools</p>
            </div>
          </div>
          <TopNav />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {integrations.map((integration) => {
            const state = getIntegration(integration.id);
            return (
              <IntegrationCard
                key={integration.id}
                {...integration}
                status={state.status}
                lastSync={state.lastSync}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Integrations;
