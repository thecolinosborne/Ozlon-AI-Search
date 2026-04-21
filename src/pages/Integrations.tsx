import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Globe, Video, CheckSquare, Youtube, Mail, HardDrive,
  Calendar, FileSpreadsheet, FileText, Presentation, BarChart3, Search, Tag, LucideIcon,
} from "lucide-react";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { isServiceGranted, GOOGLE_SERVICE_SCOPES } from "@/lib/googleScopes";

type Category = "google" | "crm" | "media" | "productivity" | "seo";

interface IntegrationEntry {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  path: string;
  category: Category;
}

const integrations: IntegrationEntry[] = [
  {
    id: "gohighlevel",
    name: "Go High Level",
    description: "CRM with contacts, pipelines, conversations, and marketing tools.",
    icon: Globe,
    path: "/integrations/gohighlevel",
    category: "crm",
  },
  {
    id: "descript",
    name: "Descript",
    description: "Video and podcast editing platform. Sync media and content assets.",
    icon: Video,
    path: "/integrations/descript",
    category: "media",
  },
  {
    id: "clickup",
    name: "ClickUp",
    description: "Task management with AI-powered project manager replies inside task comments.",
    icon: CheckSquare,
    path: "/integrations/clickup",
    category: "productivity",
  },
  // Google Apps — share one OAuth row but each has its own card.
  {
    id: "youtube",
    name: "YouTube",
    description: "Channel data, video uploads, and the YouTube Data API.",
    icon: Youtube,
    path: "/integrations/youtube",
    category: "google",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, search, send, and manage email.",
    icon: Mail,
    path: "/integrations/gmail",
    category: "google",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Browse, upload, and manage Drive files.",
    icon: HardDrive,
    path: "/integrations/google-drive",
    category: "google",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "View, create, and manage calendar events.",
    icon: Calendar,
    path: "/integrations/google-calendar",
    category: "google",
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read and write spreadsheet data.",
    icon: FileSpreadsheet,
    path: "/integrations/google-sheets",
    category: "google",
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Create and edit Google Documents.",
    icon: FileText,
    path: "/integrations/google-docs",
    category: "google",
  },
  {
    id: "google-slides",
    name: "Google Slides",
    description: "Create and edit Google Slides presentations.",
    icon: Presentation,
    path: "/integrations/google-slides",
    category: "google",
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Query GA4 properties for traffic and conversion data.",
    icon: BarChart3,
    path: "/integrations/google-analytics",
    category: "google",
  },
  {
    id: "google-search-console",
    name: "Search Console",
    description: "Pull SEO performance data for verified properties.",
    icon: Search,
    path: "/integrations/google-search-console",
    category: "google",
  },
  {
    id: "google-tag-manager",
    name: "Tag Manager",
    description: "Manage GTM containers, tags, and triggers.",
    icon: Tag,
    path: "/integrations/google-tag-manager",
    category: "google",
  },
  {
    id: "search-atlas",
    name: "Search Atlas",
    description: "Site audit, keyword research, backlinks, and rank tracking.",
    icon: Search,
    path: "/integrations/search-atlas",
    category: "seo",
  },
];

// Map UI ids to provider names in integration_connections.
// All Google Workspace services share the single provider="youtube" OAuth row.
const PROVIDER_BY_ID: Record<string, string> = {
  gohighlevel: "gohighlevel",
  descript: "descript",
  clickup: "clickup",
  youtube: "youtube",
  gmail: "youtube",
  "google-drive": "youtube",
  "google-calendar": "youtube",
  "google-sheets": "youtube",
  "google-docs": "youtube",
  "google-slides": "youtube",
  "google-analytics": "youtube",
  "google-search-console": "youtube",
  "google-tag-manager": "youtube",
  "search-atlas": "search_atlas",
};

const FILTERS: Array<{ id: "all" | Category; label: string }> = [
  { id: "all", label: "All" },
  { id: "google", label: "Google Apps" },
  { id: "seo", label: "SEO" },
  { id: "crm", label: "CRM" },
  { id: "media", label: "Media" },
  { id: "productivity", label: "Productivity" },
];

const Integrations = () => {
  const navigate = useNavigate();
  const { user, authLoading } = useAuth();
  const { getIntegration, setStatus, setApiKeyConfigured, setLastSync, disconnect } = useIntegrationsStore();
  const [filter, setFilter] = useState<"all" | Category>("all");

  // Hydrate connection status STRICTLY from per-user integration_connections.
  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    const hydrate = async () => {
      if (!user) {
        for (const i of integrations) disconnect(i.id);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("integration_connections")
          .select("provider, status, last_validated_at, metadata")
          .eq("user_id", user.id);
        if (cancelled || error) return;
        const byProvider = new Map<string, { status: string; last_validated_at: string | null; scope: string }>();
        for (const row of data || []) {
          const meta = (row.metadata || {}) as { scope?: string };
          const existing = byProvider.get(row.provider);
          if (!existing || (row.status === "connected" && existing.status !== "connected")) {
            byProvider.set(row.provider, {
              status: row.status,
              last_validated_at: row.last_validated_at,
              scope: String(meta.scope || ""),
            });
          }
        }
        for (const i of integrations) {
          const provider = PROVIDER_BY_ID[i.id];
          const row = provider ? byProvider.get(provider) : undefined;
          const isGoogleService = !!GOOGLE_SERVICE_SCOPES[i.id];

          if (!row || row.status !== "connected") {
            disconnect(i.id);
            continue;
          }

          // For Google services, only mark connected if this service's scope was granted.
          if (isGoogleService) {
            if (isServiceGranted(i.id, row.scope)) {
              setStatus(i.id, "connected");
              setApiKeyConfigured(i.id, true);
              if (row.last_validated_at) setLastSync(i.id, row.last_validated_at);
            } else {
              disconnect(i.id);
            }
          } else {
            setStatus(i.id, "connected");
            setApiKeyConfigured(i.id, true);
            if (row.last_validated_at) setLastSync(i.id, row.last_validated_at);
          }
        }
      } catch {
        /* silent */
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, [authLoading, user?.id, setStatus, setApiKeyConfigured, setLastSync, disconnect]);

  const filtered = useMemo(
    () => (filter === "all" ? integrations : integrations.filter((i) => i.category === filter)),
    [filter]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 pb-24">
      <header className="border-b border-border/50 px-4 py-4 safe-area-top">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
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
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map((integration) => {
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
