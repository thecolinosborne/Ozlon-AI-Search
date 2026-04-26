import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, FileSearch, ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  artifactId: string;
}

interface ArtifactSummary {
  id: string;
  type: string;
  title: string | null;
  version: number;
  conversation_id: string;
  status: string;
  created_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  markdown: "Document",
  plan: "Plan",
  decision: "Decision",
  action_result: "Action result",
  email_draft: "Email draft",
  doc_link: "Linked doc",
  image: "Image",
  file: "File",
  checklist: "Checklist",
};

export function InvestigationCard({ artifactId }: Props) {
  const [artifact, setArtifact] = useState<ArtifactSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    supabase
      .from("artifacts")
      .select("id, type, title, version, conversation_id, status, created_at")
      .eq("id", artifactId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setMissing(true);
        } else {
          setArtifact(data as ArtifactSummary);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [artifactId]);

  if (loading) {
    return (
      <div className="not-prose mt-3 flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Loading deliverable…</span>
      </div>
    );
  }

  if (missing || !artifact) return null;

  const typeLabel = TYPE_LABEL[artifact.type] ?? artifact.type;
  const href = `/?session=${artifact.conversation_id}`;

  return (
    <Link
      to={href}
      className={cn(
        "not-prose mt-3 group flex items-start gap-3 rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/60",
        "px-3.5 py-3 transition-all hover:border-primary/40 hover:shadow-sm"
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileSearch className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wide">
            {typeLabel}
          </Badge>
          <span className="text-[10px] text-muted-foreground">v{artifact.version}</span>
        </div>
        <div className="text-sm font-medium text-foreground truncate">
          {artifact.title ?? "Untitled deliverable"}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          Open full investigation →
        </div>
      </div>
      <ArrowUpRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary transition-colors" />
    </Link>
  );
}
