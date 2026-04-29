import { useState } from "react";
import { Plus, Pencil, Trash2, Power, X, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { Principle } from "@/hooks/useSkillObservations";

type Mutators = {
  createPrinciple: (i: { title: string; principle: string }) => Promise<{ ok: boolean; error?: string }>;
  updatePrinciple: (
    id: string,
    p: { title?: string; principle?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  deletePrinciple: (id: string) => Promise<{ ok: boolean; error?: string }>;
  activatePrinciple: (id: string) => Promise<void>;
  deactivatePrinciple: (id: string) => Promise<void>;
};

/**
 * PrincipleEditor — Phase 2 manual curation surface for cross-cutting
 * principles. Methodology adapted from "One Skill to Rule Them All" by
 * Eoghan Henn (rebelytics.com), CC BY 4.0.
 */
export function PrincipleEditor({
  principles,
  mutators,
}: {
  principles: Principle[];
  mutators: Mutators;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);

  const resetAdd = () => {
    setDraftTitle("");
    setDraftBody("");
    setShowAdd(false);
  };

  const submitNew = async () => {
    setBusy(true);
    const res = await mutators.createPrinciple({ title: draftTitle, principle: draftBody });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Could not save", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Principle added" });
    resetAdd();
  };

  const startEdit = (p: Principle) => {
    setEditingId(p.id);
    setEditTitle(p.title);
    setEditBody(p.principle);
  };

  const submitEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    const res = await mutators.updatePrinciple(editingId, {
      title: editTitle,
      principle: editBody,
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Could not update", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Principle updated" });
    setEditingId(null);
  };

  const removePrinciple = async (id: string) => {
    if (!confirm("Delete this principle? This cannot be undone.")) return;
    const res = await mutators.deletePrinciple(id);
    if (!res.ok) {
      toast({ title: "Could not delete", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Principle removed" });
  };

  return (
    <div className="space-y-3 border-t border-border/40 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          Cross-cutting principles · {principles.length}
        </div>
        {!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add principle
          </button>
        )}
      </div>

      {showAdd && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Short title (e.g. 'Always confirm before destructive actions')"
            className="w-full bg-transparent border border-border/40 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary/60"
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="The full principle. The system will apply this across every skill and session."
            rows={3}
            className="w-full bg-transparent border border-border/40 rounded-md px-2.5 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-primary/60 resize-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetAdd}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !draftTitle.trim() || !draftBody.trim()}
              onClick={submitNew}
              className="inline-flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground rounded-md px-2.5 py-1 disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              Save
            </button>
          </div>
        </div>
      )}

      {principles.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          No principles yet. Add a rule the system should respect across every skill —
          tone, escalation policy, what to never do, etc.
        </p>
      )}

      {principles.map((p) =>
        editingId === p.id ? (
          <div
            key={p.id}
            className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2"
          >
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full bg-transparent border border-border/40 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary/60"
            />
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={3}
              className="w-full bg-transparent border border-border/40 rounded-md px-2.5 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-primary/60 resize-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
              >
                <X className="w-3 h-3 inline -mt-px" /> Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={submitEdit}
                className="inline-flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground rounded-md px-2.5 py-1 disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                Save changes
              </button>
            </div>
          </div>
        ) : (
          <div
            key={p.id}
            className={`rounded-xl border p-3 transition-colors ${
              p.active
                ? "border-border/40 bg-card/40"
                : "border-border/30 bg-muted/20 opacity-70"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground/90">{p.title}</span>
                  {!p.active && (
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono px-1.5 py-0.5 rounded bg-muted/40">
                      paused
                    </span>
                  )}
                </div>
                <p className="text-xs text-foreground/70 mt-1 leading-relaxed">{p.principle}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title={p.active ? "Pause" : "Activate"}
                  onClick={() =>
                    void (p.active
                      ? mutators.deactivatePrinciple(p.id)
                      : mutators.activatePrinciple(p.id))
                  }
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Edit"
                  onClick={() => startEdit(p)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => void removePrinciple(p.id)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
