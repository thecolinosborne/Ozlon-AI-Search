import { useEffect, useState } from "react";
import { Code, Plug, TestTube, Key, Settings, ToggleLeft, ChevronRight, Shield, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { getAllAgents, getAllHooks, getAllCards, getRegistrySummary } from "@/core/registry";
import { InfinityRouterDebug } from "@/components/InfinityRouterDebug";

interface RegistryHealth {
  legacyDropped: string[];
  live: number;
  quarantined: { name: string; reason: string }[];
}

const Developer = () => {
  const [testResults, setTestResults] = useState<string[]>([]);
  const [health, setHealth] = useState<RegistryHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const summary = getRegistrySummary();
  const agents = getAllAgents();
  const hooks = getAllHooks();
  const cards = getAllCards();

  const loadHealth = async () => {
    setHealthLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.functions.supabase.co/chat?health=registry`, {
        method: "GET",
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      const json = await res.json();
      if (json?.registry) setHealth(json.registry);
    } catch (e) {
      console.warn("[developer] registry health failed", e);
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => { loadHealth(); }, []);

  const runHookTest = async (hookId: string) => {
    setTestResults((prev) => [...prev, `Testing hook: ${hookId}...`]);
    // STUB: Would actually test the hook
    setTimeout(() => {
      setTestResults((prev) => [...prev, `[STUB] Hook "${hookId}" returned mock data`]);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-background pb-24 safe-area-top">
      <div className="px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-2xl bg-primary/10">
            <Code className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Developer Mode</h1>
            <p className="text-sm text-muted-foreground">Integration hooks and testing</p>
          </div>
        </div>

        {/* Registry Summary */}
        <SettingsSection title="Registry Summary">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(summary).map(([key, value]) => (
              <div key={key} className="p-4 bg-card rounded-xl border border-border">
                <div className="text-2xl font-bold text-primary">{value}</div>
                <div className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1')}</div>
              </div>
            ))}
          </div>
        </SettingsSection>

        {/* Agents */}
        <SettingsSection title={`Agents (${agents.length})`}>
          <div className="space-y-2">
            {agents.slice(0, 6).map((agent) => (
              <div key={agent.id} className="flex items-center justify-between p-4 bg-card rounded-xl border border-border">
                <div>
                  <div className="font-medium">{agent.name}</div>
                  <div className="text-xs text-muted-foreground">{agent.id}</div>
                </div>
                <Switch checked={agent.enabled} />
              </div>
            ))}
            {agents.length > 6 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                +{agents.length - 6} more agents
              </p>
            )}
          </div>
        </SettingsSection>

        {/* Hooks */}
        <SettingsSection title={`Integration Hooks (${hooks.length})`}>
          <div className="space-y-2">
            {hooks.slice(0, 6).map((hook) => (
              <div key={hook.id} className="flex items-center justify-between p-4 bg-card rounded-xl border border-border">
                <div className="flex-1">
                  <div className="font-medium">{hook.name}</div>
                  <div className="text-xs text-muted-foreground">{hook.category}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => runHookTest(hook.id)}>
                  <TestTube className="w-4 h-4 mr-1" />
                  Test
                </Button>
              </div>
            ))}
          </div>
        </SettingsSection>

        {/* API Keys Placeholder */}
        <SettingsSection title="API Keys (Placeholder)">
          <div className="p-4 bg-card rounded-xl border border-border space-y-3">
            <p className="text-sm text-muted-foreground">
              API key storage is not implemented. Keys would be stored securely in your backend.
            </p>
            <div className="space-y-2">
              {["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ELEVEN_LABS_KEY"].map((key) => (
                <div key={key} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <Key className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-mono">{key}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Not set</span>
                </div>
              ))}
            </div>
          </div>
        </SettingsSection>

        {/* Test Output */}
        {testResults.length > 0 && (
          <SettingsSection title="Test Output">
            <div className="p-4 bg-card rounded-xl border border-border font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
              {testResults.map((line, i) => (
                <div key={i} className="text-muted-foreground">{line}</div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setTestResults([])}>
              Clear
            </Button>
          </SettingsSection>
        )}

        {/* Infinity Router Debug */}
        <InfinityRouterDebug />
      </div>
    </div>
  );
};

export default Developer;
