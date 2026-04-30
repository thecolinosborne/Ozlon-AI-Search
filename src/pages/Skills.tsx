import { useState } from "react";
import { Link } from "react-router-dom";
import { useSkills } from "@/hooks/useSkills";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Sparkles, Download, Trash2, Plus, Upload, Pencil } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { SkillDropzone } from "@/components/skills/SkillDropzone";
import { SkillEditDialog } from "@/components/skills/SkillEditDialog";

export default function Skills() {
  const { skills, loading, install, uninstall, toggle, refresh } = useSkills();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ slug: string; name: string } | null>(null);

  const handle = async (id: string, fn: () => Promise<void>, label: string) => {
    setBusy(id);
    try {
      await fn();
      toast({ title: label });
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const installed = skills.filter((s) => s.installed);
  const browse = skills.filter((s) => !s.installed);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 backdrop-blur bg-background/80 border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Sparkles className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold flex-1">Skills</h1>
          <Button asChild size="sm" variant="ghost">
            <Link to="/skills/import">
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/skills/new">
              <Plus className="w-4 h-4 mr-2" />
              Create skill
            </Link>
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        <section>
          <SkillDropzone onInstalled={refresh} />
        </section>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
            Installed ({installed.length})
          </h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : installed.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              No skills installed yet. Browse below to add your first.
            </Card>
          ) : (
            <div className="space-y-3">
              {installed.map((s) => (
                <Card key={s.id} className="p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium">{s.name}</h3>
                      <Badge variant="secondary" className="text-xs">{s.source}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{s.description}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Switch
                      checked={s.enabled}
                      disabled={busy === s.id}
                      onCheckedChange={(v) =>
                        handle(s.id, () => toggle(s.install_id!, v), v ? "Enabled" : "Disabled")
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy === s.id}
                      onClick={() => handle(s.id, () => uninstall(s.install_id!), "Uninstalled")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
            Browse
          </h2>
          {browse.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              Your catalog is empty. Build your first skill to give your AI a custom playbook.
            </Card>
          ) : (
            <div className="space-y-3">
              {browse.map((s) => (
                <Card key={s.id} className="p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium">{s.name}</h3>
                      <Badge variant="secondary" className="text-xs">{s.source}</Badge>
                      {s.trust_tier === 2 && (
                        <Badge variant="outline" className="text-xs">imported</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{s.description}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy === s.id}
                    onClick={() => handle(s.id, () => install(s.id), "Installed")}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Install
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
