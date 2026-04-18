import { useEffect, useState, useCallback } from "react";
import { Sparkles, Check, X, Inbox, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ProposalField = "identity" | "about_me" | "house_rules" | "tone_settings";

interface ProposalMeta {
  field: ProposalField;
  current_value: string;
  proposed_value: string;
  evidence?: string;
  trigger?: string;
}

interface Proposal {
  id: string;
  title: string;
  description: string;
  proposal_type: string;
  status: string;
  created_at: string;
  metadata: ProposalMeta;
}

interface PersonalityRow {
  identity: { statement?: string };
  about_me: string | null;
  house_rules: string[];
  tone_settings: Record<string, number>;
}

interface Props {
  userId: string;
  /** Callback so parent reloads its in-memory editor state after a merge */
  onApplied?: () => void;
}

const FIELD_LABEL: Record<ProposalField, string> = {
  identity: "Core identity",
  about_me: "About me",
  house_rules: "House rule",
  tone_settings: "Tone",
};

const ProposalInbox = ({ userId, onApplied }: Props) => {
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("system_evolution_proposals")
      .select("id, title, description, proposal_type, status, created_at, metadata")
      .eq("user_id", userId)
      .like("proposal_type", "personality_%")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) console.error("[ProposalInbox] load error", error);
    setProposals((data as unknown as Proposal[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const applyProposal = async (p: Proposal): Promise<boolean> => {
    const { data: row, error: fetchErr } = await supabase
      .from("user_personality")
      .select("identity, about_me, house_rules, tone_settings")
      .eq("user_id", userId)
      .maybeSingle();
    if (fetchErr) {
      console.error(fetchErr);
      return false;
    }
    const current: PersonalityRow = {
      identity: ((row?.identity as { statement?: string }) || {}),
      about_me: row?.about_me ?? null,
      house_rules: ((row?.house_rules as string[]) || []),
      tone_settings: ((row?.tone_settings as Record<string, number>) || {}),
    };

    const field = p.metadata.field;
    const proposed = p.metadata.proposed_value;

    const patch: Record<string, unknown> = { user_id: userId };
    if (field === "identity") {
      patch.identity = { ...current.identity, statement: proposed };
    } else if (field === "about_me") {
      patch.about_me = proposed;
    } else if (field === "house_rules") {
      patch.house_rules = [...current.house_rules, proposed];
    } else if (field === "tone_settings") {
      try {
        const toneDelta = JSON.parse(proposed) as Record<string, number>;
        patch.tone_settings = { ...current.tone_settings, ...toneDelta };
      } catch {
        return false;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await supabase.from("user_personality").upsert(patch as any, { onConflict: "user_id" });
    if (upErr) {
      console.error(upErr);
      return false;
    }
    return true;
  };

  const handleApprove = async (p: Proposal) => {
    setBusyId(p.id);
    const ok = await applyProposal(p);
    if (!ok) {
      toast.error("Couldn't apply proposal");
      setBusyId(null);
      return;
    }
    await supabase
      .from("system_evolution_proposals")
      .update({ status: "approved" })
      .eq("id", p.id);
    setProposals((prev) => prev.filter((x) => x.id !== p.id));
    setBusyId(null);
    toast.success("Applied");
    onApplied?.();
  };

  const handleReject = async (p: Proposal) => {
    setBusyId(p.id);
    await supabase
      .from("system_evolution_proposals")
      .update({ status: "rejected" })
      .eq("id", p.id);
    setProposals((prev) => prev.filter((x) => x.id !== p.id));
    setBusyId(null);
  };

  if (loading) {
    return (
      <div className="rounded-2xl bg-card/60 border border-border/40 p-6 mb-6">
        <div className="h-4 w-32 bg-muted/60 animate-pulse rounded" />
      </div>
    );
  }

  if (proposals.length === 0) return null;

  return (
    <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-card/60 to-card/60 border border-primary/30 p-6 mb-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="p-2.5 rounded-xl bg-primary/15 mt-0.5">
          <Inbox className="w-5 h-5 text-primary" strokeWidth={1.5} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-foreground">Proposed refinements</h2>
            <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              {proposals.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your AI noticed patterns. Approve to apply, dismiss to ignore.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            busy={busyId === p.id}
            onApprove={() => handleApprove(p)}
            onReject={() => handleReject(p)}
          />
        ))}
      </div>
    </div>
  );
};

const ProposalCard = ({
  proposal,
  busy,
  onApprove,
  onReject,
}: {
  proposal: Proposal;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) => {
  const { metadata: m } = proposal;
  const fieldLabel = FIELD_LABEL[m.field] || m.field;

  return (
    <div className="rounded-xl bg-background/60 border border-border/40 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {fieldLabel}
        </span>
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">{proposal.title}</h3>
      {proposal.description && (
        <p className="text-xs text-muted-foreground mb-3">{proposal.description}</p>
      )}

      <DiffBlock field={m.field} current={m.current_value} proposed={m.proposed_value} />

      {m.evidence && (
        <p className="text-[11px] italic text-muted-foreground/80 mt-3 pl-3 border-l-2 border-border/40">
          "{m.evidence}"
        </p>
      )}

      <div className="flex gap-2 mt-3">
        <Button
          onClick={onApprove}
          disabled={busy}
          size="sm"
          className="rounded-full h-8"
        >
          <Check className="w-3.5 h-3.5 mr-1.5" />
          Apply
        </Button>
        <Button
          onClick={onReject}
          disabled={busy}
          size="sm"
          variant="ghost"
          className="rounded-full h-8 text-muted-foreground"
        >
          <X className="w-3.5 h-3.5 mr-1.5" />
          Dismiss
        </Button>
      </div>
    </div>
  );
};

const DiffBlock = ({
  field,
  current,
  proposed,
}: {
  field: ProposalField;
  current: string;
  proposed: string;
}) => {
  const isAppend = field === "house_rules";
  const isToneJson = field === "tone_settings";

  let displayCurrent = current || "(empty)";
  let displayProposed = proposed;

  if (isToneJson) {
    try {
      const obj = JSON.parse(proposed) as Record<string, number>;
      displayProposed = Object.entries(obj)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      try {
        const cur = JSON.parse(current || "{}") as Record<string, number>;
        const keys = Object.keys(JSON.parse(proposed));
        displayCurrent = keys.map((k) => `${k}: ${cur[k] ?? "—"}`).join(", ");
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  if (isAppend) {
    return (
      <div className="rounded-lg bg-muted/30 border border-border/30 p-3 text-xs">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          New rule to add
        </div>
        <div className="text-foreground">+ {displayProposed}</div>
      </div>
    );
  }

  return (
    <div className={cn(
      "grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-stretch text-xs",
    )}>
      <div className="rounded-lg bg-muted/30 border border-border/30 p-3 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Current</div>
        <div className="text-foreground/80 line-clamp-4 whitespace-pre-wrap break-words">{displayCurrent}</div>
      </div>
      <div className="hidden md:flex items-center justify-center text-muted-foreground">
        <ArrowRight className="w-4 h-4" />
      </div>
      <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-primary mb-1">Proposed</div>
        <div className="text-foreground line-clamp-4 whitespace-pre-wrap break-words">{displayProposed}</div>
      </div>
    </div>
  );
};

export default ProposalInbox;
