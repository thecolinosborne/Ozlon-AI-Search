import { useEffect, useState } from "react";
import { Brain, Calendar, Mail, Globe, MapPin, Watch, Mic, FileText, CreditCard, Plus, Trash2, Target, ListChecks } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { MemorySettings as MemorySettingsType } from "@/core/types";

interface StandingOrder {
  id: string;
  rule: string;
  scope: string;
  priority: number;
  active: boolean;
}

interface UserGoal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
}

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

  const [orders, setOrders] = useState<StandingOrder[]>([]);
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [newOrder, setNewOrder] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: o }, { data: g }] = await Promise.all([
      supabase.from("standing_orders").select("*").eq("active", true).order("priority"),
      supabase.from("user_goals").select("*").eq("status", "active").order("updated_at", { ascending: false }),
    ]);
    setOrders((o as StandingOrder[]) || []);
    setGoals((g as UserGoal[]) || []);
    setLoading(false);
  };

  const addOrder = async () => {
    if (!newOrder.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("standing_orders").insert({
      user_id: user.id,
      rule: newOrder.trim(),
      scope: "global",
      priority: 5,
    });
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    setNewOrder("");
    toast({ title: "Standing order saved" });
    loadAll();
  };

  const removeOrder = async (id: string) => {
    await supabase.from("standing_orders").update({ active: false }).eq("id", id);
    loadAll();
  };

  const addGoal = async () => {
    if (!newGoal.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("user_goals").insert({
      user_id: user.id,
      title: newGoal.trim(),
    });
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    setNewGoal("");
    toast({ title: "Goal added" });
    loadAll();
  };

  const completeGoal = async (id: string) => {
    await supabase.from("user_goals").update({ status: "completed" }).eq("id", id);
    loadAll();
  };

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
      <div className="px-6 py-8 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-2xl bg-primary/10">
            <Brain className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Memory & Identity</h1>
            <p className="text-sm text-muted-foreground">What the worker remembers and obeys</p>
          </div>
        </div>

        {/* Standing Orders */}
        <SettingsSection title="Standing Orders">
          <div className="p-4 bg-card rounded-2xl border border-border space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ListChecks className="w-4 h-4" />
              Durable rules the worker obeys on every turn.
            </div>
            <div className="flex gap-2">
              <Input
                value={newOrder}
                onChange={(e) => setNewOrder(e.target.value)}
                placeholder='e.g. "Always answer in 2 sentences"'
                onKeyDown={(e) => e.key === "Enter" && addOrder()}
              />
              <Button onClick={addOrder} size="icon" variant="default">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-1.5">
              {loading ? (
                <div className="text-xs text-muted-foreground">Loading…</div>
              ) : orders.length === 0 ? (
                <div className="text-xs text-muted-foreground">No standing orders yet.</div>
              ) : (
                orders.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 p-2.5 bg-muted/40 rounded-lg">
                    <div className="flex-1 text-sm">{o.rule}</div>
                    <span className="text-xs text-muted-foreground">{o.scope}</span>
                    <button onClick={() => removeOrder(o.id)} className="p-1 hover:bg-background rounded">
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </SettingsSection>

        {/* Goals */}
        <SettingsSection title="Active Goals">
          <div className="p-4 bg-card rounded-2xl border border-border space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="w-4 h-4" />
              The worker references active goals when relevant.
            </div>
            <div className="flex gap-2">
              <Input
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder='e.g. "Ship Ozlon to 10 paying users"'
                onKeyDown={(e) => e.key === "Enter" && addGoal()}
              />
              <Button onClick={addGoal} size="icon" variant="default">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-1.5">
              {loading ? (
                <div className="text-xs text-muted-foreground">Loading…</div>
              ) : goals.length === 0 ? (
                <div className="text-xs text-muted-foreground">No active goals yet.</div>
              ) : (
                goals.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 p-2.5 bg-muted/40 rounded-lg">
                    <div className="flex-1 text-sm">
                      {g.title}
                      {g.target_date && (
                        <span className="ml-2 text-xs text-muted-foreground">by {g.target_date}</span>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => completeGoal(g.id)}>
                      Done
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </SettingsSection>

        {/* Info Card */}
        <div className="p-4 mb-6 bg-primary/5 border border-primary/20 rounded-2xl">
          <p className="text-sm text-muted-foreground">
            These data-source toggles are stubs. The worker actively uses standing orders, goals, and saved memories above.
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
      </div>
    </div>
  );
};

export default MemorySettings;
