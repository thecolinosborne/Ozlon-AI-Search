import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import {
  createContact,
  updateContact,
  type ContactInput,
} from "@/services/contactsService";

export interface EditableContact {
  id: string;
  display_name: string;
  primary_email: string | null;
  primary_phone?: string | null;
  company?: string | null;
  notes?: string | null;
  starred?: boolean;
  external_ids?: Record<string, string> | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create a new contact */
  contact?: EditableContact | null;
  ghlConnected: boolean;
  onSaved: () => void;
}

const empty: ContactInput = {
  display_name: "",
  primary_email: "",
  primary_phone: "",
  company: "",
  notes: "",
  starred: false,
};

export function ContactEditorDialog({ open, onOpenChange, contact, ghlConnected, onSaved }: Props) {
  const [form, setForm] = useState<ContactInput>(empty);
  const [pushGhl, setPushGhl] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (contact) {
      setForm({
        display_name: contact.display_name,
        primary_email: contact.primary_email || "",
        primary_phone: contact.primary_phone || "",
        company: contact.company || "",
        notes: contact.notes || "",
        starred: !!contact.starred,
      });
      setPushGhl(ghlConnected && !!contact.external_ids?.gohighlevel);
    } else {
      setForm(empty);
      setPushGhl(false);
    }
  }, [open, contact, ghlConnected]);

  const set = (key: keyof ContactInput, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!form.display_name.trim()) {
      toast({ title: "Add a name first", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const sync = contact
        ? await updateContact(contact.id, form, pushGhl, contact.external_ids || {})
        : (await createContact(form, pushGhl)).sync;

      if (sync.ghl === "failed") {
        toast({
          title: "Saved here, but GoHighLevel refused the change",
          description: sync.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: contact ? "Contact updated" : "Contact added",
          description:
            sync.ghl === "skipped" ? undefined : "Also saved in GoHighLevel.",
        });
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({
        title: "Couldn't save the contact",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{contact ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription className="text-xs">
            Saved to your People list. Turn on the switch to keep it in step with GoHighLevel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="c-name" className="text-xs">Name</Label>
            <Input id="c-name" value={form.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="Ben Carter" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-email" className="text-xs">Email</Label>
              <Input id="c-email" type="email" value={form.primary_email || ""} onChange={(e) => set("primary_email", e.target.value)} placeholder="ben@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone" className="text-xs">Phone</Label>
              <Input id="c-phone" value={form.primary_phone || ""} onChange={(e) => set("primary_phone", e.target.value)} placeholder="+1 555 0100" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-company" className="text-xs">Company</Label>
            <Input id="c-company" value={form.company || ""} onChange={(e) => set("company", e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-notes" className="text-xs">Notes</Label>
            <Textarea id="c-notes" rows={3} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="How you know them, what matters to them" />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
            <div>
              <div className="text-xs font-medium">Keep in GoHighLevel</div>
              <div className="text-[11px] text-muted-foreground">
                {ghlConnected ? "Saves the same details to your CRM." : "Connect GoHighLevel to enable this."}
              </div>
            </div>
            <Switch checked={pushGhl} onCheckedChange={setPushGhl} disabled={!ghlConnected} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
            <div className="text-xs font-medium">Pin to Inner Circle</div>
            <Switch checked={!!form.starred} onCheckedChange={(v) => set("starred", v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            {contact ? "Save changes" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
