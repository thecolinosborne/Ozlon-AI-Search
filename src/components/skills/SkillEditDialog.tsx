import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Props {
  slug: string;
  name: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}

export function SkillEditDialog({ slug, name, open, onOpenChange, onSaved }: Props) {
  const [mode, setMode] = useState<"append" | "prepend" | "replace_section">("append");
  const [section, setSection] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!content.trim()) {
      toast({ title: "Add some content first", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("skills-edit", {
        body: {
          op: "patch_instructions",
          slug,
          mode,
          section: mode === "replace_section" ? section.trim() : undefined,
          content,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Edit failed");
      toast({
        title: `Saved v${data.version}`,
        description: data.forked_from
          ? `Forked from "${data.forked_from}" into your private copy.`
          : "Skill updated.",
      });
      setContent("");
      setSection("");
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast({
        title: "Edit failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit skill: {name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Merge strategy</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as typeof mode)}
              className="flex gap-4 mt-2"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="append" /> Append
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="prepend" /> Prepend
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="replace_section" /> Replace section
              </label>
            </RadioGroup>
          </div>
          {mode === "replace_section" && (
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Section name (without "## ")
              </Label>
              <Input
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="Prerequisites"
                className="mt-2"
              />
            </div>
          )}
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Content</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder={
                mode === "append"
                  ? "Markdown to append to the skill instructions…"
                  : mode === "prepend"
                  ? "Markdown to prepend at the top…"
                  : "Replacement body for the section…"
              }
              className="mt-2 font-mono text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Builtin and imported skills will be forked into a private copy automatically. Each save bumps the
            version and is audited.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
