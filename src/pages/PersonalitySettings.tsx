import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Sparkles, User2, BookOpen, Scale, Drama, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ToneSettings {
  formality?: number;     // 0 casual ↔ 100 formal
  verbosity?: number;     // 0 terse ↔ 100 verbose
  challenge?: number;     // 0 deferential ↔ 100 challenging
  warmth?: number;        // 0 stoic ↔ 100 warm
}

interface PersonalityRow {
  identity: { statement?: string };
  about_me: string | null;
  house_rules: string[];
  tone_settings: ToneSettings;
  reference_persona: string | null;
}

const DEFAULT_TONE: ToneSettings = {
  formality: 30,
  verbosity: 35,
  challenge: 60,
  warmth: 50,
};

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

const PersonalitySettings = () => {
  const navigate = useNavigate();
  const { user, authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [identityStatement, setIdentityStatement] = useState("");
  const [aboutMe, setAboutMe] = useState("");
  const [houseRules, setHouseRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState("");
  const [tone, setTone] = useState<ToneSettings>(DEFAULT_TONE);
  const [referencePersona, setReferencePersona] = useState("");

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
      if (error) console.error("[Personality] load error", error);
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

  const handleSave = async () => {
    if (!user) {
      toast.error("Sign in to save your personality profile");
      return;
    }
    setSaving(true);
    const payload = {
      user_id: user.id,
      identity: { statement: identityStatement.trim() },
      about_me: aboutMe.trim() || null,
      house_rules: houseRules.filter(r => r.trim()),
      tone_settings: tone,
      reference_persona: referencePersona.trim() || null,
    };
    const { error } = await supabase
      .from("user_personality")
      .upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      console.error("[Personality] save error", error);
      toast.error("Failed to save");
      return;
    }
    toast.success("Personality saved — applied to next message");
  };

  const addRule = () => {
    const v = newRule.trim();
    if (!v) return;
    setHouseRules([...houseRules, v]);
    setNewRule("");
  };

  const removeRule = (i: number) => {
    setHouseRules(houseRules.filter((_, idx) => idx !== i));
  };

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
            Personality profiles are unique to your account. Sign in to author yours.
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
              <h1 className="text-lg font-semibold text-foreground">Personality</h1>
              <p className="text-xs text-muted-foreground">Make it yours</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} size="sm" className="rounded-full">
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-6">
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
              <p className="text-xs text-muted-foreground italic px-1">
                No rules yet. Add one below.
              </p>
            )}
            {houseRules.map((rule, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-3 rounded-xl bg-muted/40 border border-border/30"
              >
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
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {left}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {right}
                    </span>
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

        <div className={cn(
          "rounded-2xl border border-border/30 bg-muted/30 p-5 text-xs text-muted-foreground leading-relaxed",
        )}>
          Your personality profile is loaded into the system prompt at the top of every conversation, above the default Ozlon persona. Changes apply on the next message you send.
        </div>
      </div>
    </div>
  );
};

export default PersonalitySettings;
