import { useState } from "react";
import { Brain, Calendar, Mail, Globe, MapPin, Watch, Mic, FileText, CreditCard } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/SettingsSection";
import type { MemorySettings as MemorySettingsType } from "@/core/types";

const MemorySettings = () => {
  const [settings, setSettings] = useState<MemorySettingsType>({
    calendar: false,
    email: false,
    browsing: false,
    location: false,
    wearable: false,
    voice: false,
    documents: true,
    transactions: false,
  });

  const toggleSetting = (key: keyof MemorySettingsType) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const memoryOptions = [
    { key: "calendar" as const, icon: Calendar, label: "Calendar Memory", description: "Remember events and scheduling patterns" },
    { key: "email" as const, icon: Mail, label: "Email Memory", description: "Learn from email content and patterns" },
    { key: "browsing" as const, icon: Globe, label: "Browsing Memory", description: "Track browsing history for context" },
    { key: "location" as const, icon: MapPin, label: "Location Memory", description: "Remember places and movement patterns" },
    { key: "wearable" as const, icon: Watch, label: "Wearable Memory", description: "Track health and fitness data" },
    { key: "voice" as const, icon: Mic, label: "Voice Memory", description: "Remember voice notes and conversations" },
    { key: "documents" as const, icon: FileText, label: "Document Memory", description: "Learn from documents you upload" },
    { key: "transactions" as const, icon: CreditCard, label: "Transaction Memory", description: "Track spending and financial patterns" },
  ];

  return (
    <div className="min-h-screen bg-background pb-24 safe-area-top">
      <div className="px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-2xl bg-primary/10">
            <Brain className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Memory Settings</h1>
            <p className="text-sm text-muted-foreground">Control what the Orb remembers</p>
          </div>
        </div>

        {/* Info Card */}
        <div className="p-4 mb-6 bg-primary/5 border border-primary/20 rounded-2xl">
          <p className="text-sm text-muted-foreground">
            These settings control what data sources the Orb can access for building your personal knowledge graph. 
            Disabled sources will not be processed or stored.
          </p>
        </div>

        {/* Memory Toggles */}
        <SettingsSection title="Data Sources">
          <div className="space-y-2">
            {memoryOptions.map(({ key, icon: Icon, label, description }) => (
              <button
                key={key}
                onClick={() => toggleSetting(key)}
                className="w-full flex items-center gap-4 p-4 bg-card rounded-xl border border-border hover:bg-muted/50 transition-colors"
              >
                <div className="p-2 rounded-xl bg-muted">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                <Switch checked={settings[key]} />
              </button>
            ))}
          </div>
        </SettingsSection>

        {/* Status */}
        <SettingsSection title="Memory Status">
          <div className="p-4 bg-card rounded-xl border border-border">
            <div className="text-sm text-muted-foreground mb-4">
              All memory features are currently stubs. No actual data is being collected or stored.
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-lg font-bold">0</div>
                <div className="text-xs text-muted-foreground">Items stored</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-lg font-bold">0 KB</div>
                <div className="text-xs text-muted-foreground">Storage used</div>
              </div>
            </div>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
};

export default MemorySettings;
