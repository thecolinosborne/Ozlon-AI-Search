import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Globe, Video, Sparkles, Cpu, Facebook } from "lucide-react";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";

const integrations = [
  {
    id: "maton",
    name: "Maton AI",
    description: "API gateway for 100+ services. Connect Gmail, Calendar, Drive, and more.",
    icon: Zap,
    path: "/integrations/maton",
  },
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
    id: "ai-processor",
    name: "AI Processor",
    description: "Configure AI providers, models, and routing logic for processing.",
    icon: Cpu,
    path: "/integrations/ai-processor",
  },
  {
    id: "facebook-ads",
    name: "Facebook Ads",
    description: "Meta Marketing API — campaigns, ad sets, and performance metrics.",
    icon: Facebook,
    path: "/integrations/facebook-ads",
  },
];

const Integrations = () => {
  const navigate = useNavigate();
  const { getIntegration } = useIntegrationsStore();

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
