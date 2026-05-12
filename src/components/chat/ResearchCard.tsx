import { useEffect, useState } from "react";
import { Loader2, Sparkles, Globe, Brain, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Props {
  reportId: string;
}

interface Report {
  id: string;
  query: string;
  answer: string;
  confidence: number | null;
  personal_context: unknown;
  follow_ups: unknown;
  created_at: string;
}

interface SourceRow {
  id: string;
  source_type: string;
  citation_index: number;
  url: string | null;
  title: string | null;
  snippet: string | null;
  relevance_score: number | null;
}

export function ResearchCard({ reportId }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    (async () => {
      const [r, s] = await Promise.all([
        supabase
          .from("research_reports")
          .select("id, query, answer, confidence, personal_context, follow_ups, created_at")
          .eq("id", reportId)
          .maybeSingle(),
        supabase
          .from("research_sources")
          .select("id, source_type, citation_index, url, title, snippet, relevance_score")
          .eq("report_id", reportId)
          .order("citation_index", { ascending: true }),
      ]);
      if (cancelled) return;
      if (r.error || !r.data) {
        setMissing(true);
      } else {
        setReport(r.data as Report);
        setSources((s.data ?? []) as SourceRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  if (loading) {
    return (
      <div className="not-prose mt-3 flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Loading research…</span>
      </div>
    );
  }

  if (missing || !report) return null;

  const conf = typeof report.confidence === "number" ? Math.round(report.confidence * 100) : null;
  const personal = Array.isArray(report.personal_context) ? (report.personal_context as string[]) : [];
  const followUps = Array.isArray(report.follow_ups) ? (report.follow_ups as string[]) : [];
  const web = sources.filter((s) => s.source_type === "web");
  const wisdom = sources.filter((s) => s.source_type === "wisdom");

  return (
    <div
      className={cn(
        "not-prose mt-3 rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/60 backdrop-blur-md overflow-hidden"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono uppercase tracking-wide text-primary/80">Research</span>
            {conf !== null && (
              <span className="text-[10px] text-muted-foreground">{conf}% confidence</span>
            )}
            <span className="text-[10px] text-muted-foreground">
              · {web.length} web · {wisdom.length} memory
            </span>
          </div>
          <div className="text-sm font-medium text-foreground truncate">{report.query}</div>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border/40 px-3.5 py-3 space-y-3">
          {personal.length > 0 && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wide text-primary/80 mb-1">
                Personal context
              </div>
              <ul className="space-y-1">
                {personal.map((p, i) => (
                  <li key={i} className="text-xs text-foreground/80">• {p}</li>
                ))}
              </ul>
            </div>
          )}

          {web.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1.5">
                <Globe className="h-3 w-3" /> Web sources
              </div>
              <ul className="space-y-1.5">
                {web.map((s) => (
                  <li key={s.id}>
                    <a
                      href={s.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2 text-xs text-foreground/80 hover:text-primary transition-colors"
                    >
                      <span className="text-[10px] font-mono text-muted-foreground mt-0.5 shrink-0">
                        [{s.citation_index}]
                      </span>
                      <span className="min-w-0 flex-1 truncate">{s.title ?? s.url}</span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground/60 group-hover:text-primary shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {wisdom.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1.5">
                <Brain className="h-3 w-3" /> Wisdom memories
              </div>
              <ul className="space-y-1">
                {wisdom.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-xs text-foreground/80">
                    <span className="text-[10px] font-mono text-muted-foreground mt-0.5 shrink-0">
                      [W{s.citation_index}]
                    </span>
                    <span className="min-w-0 flex-1">{s.title ?? s.snippet}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {followUps.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1.5">
                Follow-ups
              </div>
              <div className="flex flex-wrap gap-1.5">
                {followUps.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-[11px] text-foreground/80"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
