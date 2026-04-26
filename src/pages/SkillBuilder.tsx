import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Plus, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const COMMON_TOOLS = [
  "send_email", "list_emails", "create_email_draft", "label_email",
  "create_calendar_event", "calendar_list_events", "calendar_find_free_slots",
  "search_google_drive", "create_google_doc", "docs_apply_markdown",
  "create_google_sheet", "sheets_append_rows",
  "slack_send_message", "clickup_create_task", "research_web",
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

export default function SkillBuilder() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [toolDraft, setToolDraft] = useState("");
  const [instructions, setInstructions] = useState("");
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);

  const slug = slugify(name);
  const valid = name.length >= 3 && description.length >= 10 && instructions.length >= 20 && keywords.length > 0;

  const addKeyword = () => {
    const v = keywordDraft.trim().toLowerCase();
    if (v && !keywords.includes(v)) setKeywords([...keywords, v]);
    setKeywordDraft("");
  };
  const addTool = (t?: string) => {
    const v = (t ?? toolDraft).trim();
    if (v && !tools.includes(v)) setTools([...tools, v]);
    setToolDraft("");
  };

  const handleSave = async () => {
    if (!user || !valid) return;
    setSaving(true);
    try {
      const manifest = {
        slug,
        name,
        description,
        version: "1.0.0",
        triggers: [{ type: "keyword", match: keywords }],
        tools_required: tools,
        instructions,
        requires_confirmation: requiresConfirmation,
      };
      const { error } = await supabase.from("skills").insert({
        slug,
        name,
        description,
        version: "1.0.0",
        manifest,
        source: "user",
        visibility: "private",
        trust_tier: 1,
        author_user_id: user.id,
      });
      if (error) throw error;
      toast({ title: "Skill created", description: `${name} is now in your catalog.` });
      navigate("/skills");
    } catch (e) {
      toast({
        title: "Couldn't save skill",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 backdrop-blur bg-background/80 border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/skills" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Sparkles className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">New Skill</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card className="p-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g. Daily Standup Prep"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {slug && <p className="text-xs text-muted-foreground font-mono">slug: {slug}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Input
              id="desc"
              placeholder="One line. What does this skill do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <div>
            <Label>Trigger keywords</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Phrases that should activate this skill in chat.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder='e.g. "standup prep"'
              value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
            />
            <Button type="button" variant="secondary" onClick={addKeyword}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {keywords.map((k) => (
                <Badge key={k} variant="secondary" className="gap-1">
                  {k}
                  <button onClick={() => setKeywords(keywords.filter((x) => x !== k))}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <div>
            <Label>Required tools</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Pick from common tools or type any tool name available in chat.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {COMMON_TOOLS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addTool(t)}
                disabled={tools.includes(t)}
                className="text-xs px-2 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-mono"
              >
                + {t}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="custom_tool_name"
              value={toolDraft}
              onChange={(e) => setToolDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTool())}
            />
            <Button type="button" variant="secondary" onClick={() => addTool()}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {tools.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tools.map((t) => (
                <Badge key={t} className="gap-1 font-mono">
                  {t}
                  <button onClick={() => setTools(tools.filter((x) => x !== t))}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <div>
            <Label htmlFor="instr">Instructions</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Step-by-step playbook the AI follows when this skill activates.
            </p>
          </div>
          <Textarea
            id="instr"
            rows={10}
            placeholder={`1. Pull today's calendar events\n2. Summarize attendees & topics\n3. List 3 talking points per meeting\n4. Surface any unread Slack threads from attendees`}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="font-mono text-sm"
          />
        </Card>

        <Card className="p-6 flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Require confirmation</p>
            <p className="text-xs text-muted-foreground">
              Ask before running destructive or write actions.
            </p>
          </div>
          <Switch checked={requiresConfirmation} onCheckedChange={setRequiresConfirmation} />
        </Card>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate("/skills")}>
            Cancel
          </Button>
          <Button disabled={!valid || saving} onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Save skill"}
          </Button>
        </div>
      </main>
    </div>
  );
}
