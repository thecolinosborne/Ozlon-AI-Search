import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Upload, FileJson, AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Issue = { level: "error" | "warning"; field: string; message: string };
type ValidateResult = {
  valid: boolean;
  issues: Issue[];
  warnings: Issue[];
  normalized: Record<string, unknown> | null;
  installed?: { id: string; slug: string } | null;
};

const SAMPLE = `{
  "slug": "morning-briefing",
  "name": "Morning Briefing",
  "description": "Pulls today's calendar, unread email, and Slack mentions into a 60-second brief.",
  "version": "1.0.0",
  "triggers": [{ "type": "keyword", "match": ["morning briefing", "brief me"] }],
  "tools_required": ["calendar_list_events", "list_emails"],
  "tools_optional": ["slack_send_message"],
  "instructions": "1. Pull today's calendar events.\\n2. List unread emails needing reply.\\n3. Summarize as a 60-second brief.",
  "side_effect": "read",
  "requires_confirmation": false
}`;

export default function SkillImport() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [json, setJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [busy, setBusy] = useState<"validate" | "install" | null>(null);

  const handleFile = async (file: File) => {
    if (file.size > 100_000) {
      toast({ title: "File too large", description: "Max 100 KB", variant: "destructive" });
      return;
    }
    const text = await file.text();
    setJson(text);
    setResult(null);
    setParseError(null);
  };

  const parsed = (): unknown | null => {
    try {
      const obj = JSON.parse(json);
      setParseError(null);
      return obj;
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
      return null;
    }
  };

  const runValidate = async (install = false) => {
    const manifest = parsed();
    if (!manifest) return;
    setBusy(install ? "install" : "validate");
    try {
      const { data, error } = await supabase.functions.invoke("skills-validate", {
        body: { manifest, install },
      });
      if (error) throw error;
      setResult(data as ValidateResult);
      if (install && data?.installed) {
        toast({ title: "Skill imported", description: `${data.installed.slug} added to your catalog.` });
        navigate("/skills");
      } else if (install && !data?.valid) {
        toast({ title: "Fix errors before installing", variant: "destructive" });
      } else if (data?.valid) {
        toast({ title: "Manifest valid", description: "Ready to install." });
      } else {
        toast({ title: "Validation failed", description: `${data?.issues?.length ?? 0} error(s)`, variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: "Validation error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
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
          <h1 className="text-xl font-semibold">Import Skill</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-medium">Paste or upload a .skill.json file</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Manifests are validated against the Ozlon Skill schema and your tool whitelist before installing.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setJson(SAMPLE)}>
              <FileJson className="w-4 h-4 mr-2" />
              Use sample
            </Button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} className="w-full">
            <Upload className="w-4 h-4 mr-2" />
            Upload .skill.json
          </Button>

          <Textarea
            rows={14}
            placeholder="Paste manifest JSON here…"
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setResult(null);
              setParseError(null);
            }}
            className="font-mono text-xs"
          />

          {parseError && (
            <div className="text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" />
              {parseError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={!json.trim() || busy !== null}
              onClick={() => runValidate(false)}
            >
              {busy === "validate" ? "Validating…" : "Validate"}
            </Button>
            <Button
              disabled={!json.trim() || busy !== null}
              onClick={() => runValidate(true)}
            >
              <Download className="w-4 h-4 mr-2" />
              {busy === "install" ? "Installing…" : "Validate & install"}
            </Button>
          </div>
        </Card>

        {result && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              {result.valid ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  <h2 className="font-medium">Valid manifest</h2>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  <h2 className="font-medium">Validation failed</h2>
                </>
              )}
              <Badge variant="secondary" className="ml-auto">
                {result.issues.length} errors · {result.warnings.length} warnings
              </Badge>
            </div>

            {result.issues.length > 0 && (
              <div className="space-y-2">
                {result.issues.map((i, idx) => (
                  <div key={idx} className="text-sm border-l-2 border-destructive pl-3">
                    <span className="font-mono text-xs text-destructive">{i.field}</span>
                    <p className="text-foreground">{i.message}</p>
                  </div>
                ))}
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="space-y-2">
                {result.warnings.map((i, idx) => (
                  <div key={idx} className="text-sm border-l-2 border-muted-foreground/40 pl-3">
                    <span className="font-mono text-xs text-muted-foreground">{i.field}</span>
                    <p className="text-muted-foreground">{i.message}</p>
                  </div>
                ))}
              </div>
            )}

            {result.valid && result.normalized && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">View normalized manifest</summary>
                <pre className="mt-2 p-3 bg-muted rounded-md overflow-auto">
                  {JSON.stringify(result.normalized, null, 2)}
                </pre>
              </details>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
