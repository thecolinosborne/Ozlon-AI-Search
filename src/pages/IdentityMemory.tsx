import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Sparkles, User2, BookOpen, Scale, Drama, Plus, X, ListChecks, Target, Trash2, Calendar, Mail, Globe, MapPin, Watch, Mic, FileText, CreditCard, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import ProposalInbox from "@/components/personality/ProposalInbox";
import type { MemorySettings as MemorySettingsType } from "@/core/types";

interface ToneSettings {
  formality?: number;
  verbosity?: number;
  challenge?: number;
  warmth?: number;
}

interface PersonalityRow {
  identity: { statement?: string };
  about_me: string | null;
  house_rules: string[];
  tone_settings: ToneSettings;
  reference_persona: string | null;
}

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

const DEFAULT_TONE: ToneSettings = { formality: 30, verbosity: 35, challenge: 60, warmth: 50 };

const TONE_LABELS: Record<keyof ToneSettings, [string, string, string]> = {
  formality: ["Formality", "Casual", "Formal"],
  verbosity: ["Verbosity", "Terse", "Verbose"],
  challenge: ["Pushback", "Deferential", "Challenging"],
  warmth: ["Warmth", "Stoic", "Warm"],
};

const Section = ({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof User2;
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-2xl bg-card/60 border border-border/40 p-6 mb-6">
    <div className="flex items-start gap-4 mb-4">
      <div className="p-2.5 rounded-xl bg-muted/60 mt-0.5">
        <Icon className="w-5 h-5 text-foreground/70" strokeWidth={1.5} />
      </div>
      <div className="flex-1">
        <h2 className="font-medium text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
    <div>{children}</div>
  </div>
);

const SectionHeader = ({ title }: { title: string }) => (
  <div className="flex items-center gap-2 mt-10 mb-4 px-1">
    <span aria-hidden className="w-5 h-0.5 rounded-full bg-gradient-to-r from-primary/60 to-primary/10" />
    <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.15em]">{title}</h2>
  </div>
);

const IdentityMemory = () => {
  const navigate = useNavigate();
  const { user, authLoading } = useAuth();

  // Personality state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [identityStatement, setIdentityStatement] = useState("");
  const [aboutMe, setAboutMe] = useState("");
  const [houseRules, setHouseRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState("");
  const [tone, setTone] = useState<ToneSettings>(DEFAULT_TONE);
  const [referencePersona, setReferencePersona] = useState("");

  // Memory state
  const [orders, setOrders] = useState<StandingOrder[]>([]);
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [newOrder, setNewOrder] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [memLoading, setMemLoading] = useState(true);
  const [dataSources, setDataSources] = useState<MemorySettingsType>({
    calendar: false,
    email: false,
    browsing: false,
    location: false,
    wearable: false,
    voice: false,
    documents: true,
    transactions: false,
  });

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("user_personality")
        .select("identity, about_me, house_rules, tone_settings, reference_persona")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) console.error("[IdentityMemory] personality load error", error);
      if (data) {
        const row = data as unknown as PersonalityRow;
        setIdentityStatement(row.identity?.statement || "");
        setAboutMe(row.about_me || "");
        setHouseRules(Array.isArray(row.house_rules) ? row.house_rules : []);
        setTone({ ...DEFAULT_TONE, ...(row.tone_settings || {}) });
        setReferencePersona(row.reference_persona || "");
      }
      setLoading(false);
    };
    if (!authLoading) load();
  }, [user, authLoading]);

  useEffect(() => {
    if (!user) return;
    loadMemory();
  }, [user]);

  const loadMemory = async () => {
    setMemLoading(true);
    const [{ data: o }, { data: g }] = await Promise.all([
      supabase.from("standing_orders").select("*").eq("active", true).order("priority"),
      supabase.from("user_goals").select("*").eq("status", "active").order("updated_at", { ascending: false }),
    ]);
    setOrders((o as StandingOrder[]) || []);
    setGoals((g as UserGoal[]) || []);
    setMemLoading(false);
  };

  const handleSave = async () => {
    if (!user) {
      toast.error("Sign in to save your identity profile");
      return;
    }
    setSaving(true);
    const payload = {
      user_id: user.id,
      identity: { statement: identityStatement.trim() } as unknown as Record<string, unknown>,
      about_me: aboutMe.trim() || null,
      house_rules: houseRules.filter((r) => r.trim()),
      tone_settings: tone as unknown as Record<string, unknown>,
      reference_persona: referencePersona.trim() || null,
    };
    const { error } = await supabase
      .from("user_personality")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      console.error("[IdentityMemory] save error", error);
      toast.error("Failed to save");
      return;
    }
    toast.success("Identity saved — applied to next message");
  };

  const addRule = () => {
    const v = newRule.trim();
    if (!v) return;
    setHouseRules([...houseRules, v]);
    setNewRule("");
  };
  const removeRule = (i: number) => setHouseRules(houseRules.filter((_, idx) => idx !== i));

  const addOrder = async () => {
    if (!newOrder.trim() || !user) return;
    const { error } = await supabase.from("standing_orders").insert({
      user_id: user.id,
      rule: newOrder.trim(),
      scope: "global",
      priority: 5,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewOrder("");
    toast.success("Standing order saved");
    loadMemory();
  };

  const removeOrder = async (id: string) => {
    await supabase.from("standing_orders").update({ active: false }).eq("id", id);
    loadMemory();
  };

  const addGoal = async () => {
    if (!newGoal.trim() || !user) return;
    const { error } = await supabase.from("user_goals").insert({
      user_id: user.id,
      title: newGoal.trim(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewGoal("");
    toast.success("Goal added");
    loadMemory();
  };

  const completeGoal = async (id: string) => {
    await supabase.from("user_goals").update({ status: "completed" }).eq("id", id);
    loadMemory();
  };

  const toggleDataSource = (key: keyof MemorySettingsType) => {
    setDataSources((prev) => ({ ...prev, [key]: !prev[key] }));
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

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-medium text-foreground mb-2">Sign in required</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Identity & Memory is unique to your account. Sign in to author yours.
          </p>
          <Button onClick={() => navigate("/auth")}>Sign in</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 pb-32">
      <header className="border-b border-border/50 px-4 py-4 safe-area-top sticky top-0 backdrop-blur-xl bg-background/70 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/settings")}
              className="p-2 hover:bg-muted rounded-full transition-colors"
              aria-label="Back to settings"
            >
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Identity & Memory</h1>
              <p className="text-xs text-muted-foreground">Who your AI is, and what it knows</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} size="sm" className="rounded-full">
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        <ProposalInbox userId={user.id} onApplied={() => window.location.reload()} />

        <SectionHeader title="Identity" />

        <Section
          icon={Sparkles}
          title="Core identity"
          description="Define who your AI is in one line. This sits at the top of every conversation."
        >
          <Textarea
            value={identityStatement}
            onChange={(e) => setIdentityStatement(e.target.value)}
            placeholder='e.g. "You are Jarvis. You serve me. Calm, witty, never panics. Loyal above all."'
            className="min-h-[100px] resize-none"
          />
        </Section>

        <Section
          icon={User2}
          title="About me"
          description="Long-form context about you — background, values, what you're building, how you think."
        >
          <Textarea
            value={aboutMe}
            onChange={(e) => setAboutMe(e.target.value)}
            placeholder="Tell your AI who you are. The more it knows, the sharper its judgment becomes."
            className="min-h-[180px] resize-none"
          />
        </Section>

        <Section
          icon={Scale}
          title="House rules"
          description="Explicit do's and don'ts. These override defaults."
        >
          <div className="space-y-2 mb-3">
            {houseRules.length === 0 && (
              <p className="text-xs text-muted-foreground italic px-1">No rules yet. Add one below.</p>
            )}
            {houseRules.map((rule, i) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-muted/40 border border-border/30">
                <span className="text-sm text-foreground flex-1">{rule}</span>
                <button
                  onClick={() => removeRule(i)}
                  className="p-1 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-destructive"
                  aria-label="Remove rule"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRule();
                }
              }}
              placeholder='e.g. "Always push back if I sound lazy"'
            />
            <Button onClick={addRule} variant="secondary" size="icon" aria-label="Add rule">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </Section>

        <Section
          icon={BookOpen}
          title="Voice & tone"
          description="Calibrate how your AI speaks. Adjusts on every reply."
        >
          <div className="space-y-6">
            {(Object.keys(TONE_LABELS) as (keyof ToneSettings)[]).map((key) => {
              const [label, left, right] = TONE_LABELS[key];
              const value = tone[key] ?? 50;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium text-foreground">{label}</Label>
                    <span className="text-xs text-muted-foreground tabular-nums">{value}</span>
                  </div>
                  <Slider
                    value={[value]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={(v) => setTone({ ...tone, [key]: v[0] })}
                  />
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{left}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{right}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          icon={Drama}
          title="Reference persona"
          description="Optional. Channel a known voice — the AI will mirror its style."
        >
          <Textarea
            value={referencePersona}
            onChange={(e) => setReferencePersona(e.target.value)}
            placeholder='e.g. "Channel Jarvis: dry wit, anticipates needs, never flatters."'
            className="min-h-[100px] resize-none"
          />
        </Section>

        <SectionHeader title="Memory" />

        <Section
          icon={ListChecks}
          title="Standing orders"
          description="Durable rules the worker obeys on every turn."
        >
          <div className="flex gap-2 mb-3">
            <Input
              value={newOrder}
              onChange={(e) => setNewOrder(e.target.value)}
              placeholder='e.g. "Always answer in 2 sentences"'
              onKeyDown={(e) => e.key === "Enter" && addOrder()}
            />
            <Button onClick={addOrder} size="icon" variant="secondary">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="space-y-1.5">
            {memLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : orders.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-1">No standing orders yet.</div>
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
        </Section>

        <Section
          icon={Target}
          title="Active goals"
          description="The worker references active goals when relevant."
        >
          <div className="flex gap-2 mb-3">
            <Input
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              placeholder='e.g. "Ship Ozlon to 10 paying users"'
              onKeyDown={(e) => e.key === "Enter" && addGoal()}
            />
            <Button onClick={addGoal} size="icon" variant="secondary">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="space-y-1.5">
            {memLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : goals.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-1">No active goals yet.</div>
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
        </Section>

        <Section
          icon={Brain}
          title="Data sources"
          description="Toggle which memory streams the worker is allowed to learn from."
        >
          <div className="space-y-2">
            {memoryOptions.map(({ key, icon: Icon, label, description }) => (
              <button
                key={key}
                onClick={() => toggleDataSource(key)}
                className="w-full flex items-center gap-4 p-3 bg-muted/30 rounded-xl border border-border/30 hover:bg-muted/50 transition-colors"
              >
                <div className="p-2 rounded-xl bg-background/50">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-[11px] text-muted-foreground">{description}</div>
                </div>
                <Switch checked={dataSources[key]} />
              </button>
            ))}
          </div>
        </Section>

        <div className="rounded-2xl border border-border/30 bg-muted/30 p-5 text-xs text-muted-foreground leading-relaxed">
          Your identity profile, standing orders, and active goals are loaded into the system prompt at the top of every conversation. Changes apply on the next message you send.
        </div>
      </div>
    </div>
  );
};

export default IdentityMemory;
