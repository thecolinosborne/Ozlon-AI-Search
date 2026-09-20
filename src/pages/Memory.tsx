import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowLeft,
  Brain,
  Search,
  X,
  ExternalLink,
  Calendar,
  Tag,
  Trash2,
  Link as LinkIcon,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  User,
  CalendarDays,
  FileText,
  Mail,
  Scale,
  Flag,
  Mountain,
  BarChart3,
  Zap,
  Star,
  Repeat,
  Target,
  Gem,
  Lightbulb,
  Info,
  Database,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

interface MemoryResult {
  source: "memory" | "artifact";
  id: string;
  type: string;
  resource_type: string | null;
  summary: string | null;
  content: string | null;
  similarity: number | null;
  source_tool: string | null;
  external_id: string | null;
  external_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface MemoryLink {
  id: string;
  relationship: string;
  target: {
    id: string;
    summary: string;
    resource_type: string;
    external_url: string;
  } | null;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "fact", label: "Facts" },
  { key: "preference", label: "Preferences" },
  { key: "task", label: "Tasks" },
  { key: "contact", label: "Contacts" },
  { key: "event", label: "Events" },
  { key: "doc", label: "Docs" },
  { key: "email", label: "Emails" },
  { key: "decision", label: "Decisions" },
  { key: "issue", label: "Issues" },
  { key: "rock", label: "Rocks" },
  { key: "action", label: "Actions" },
];

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const ICON_FOR_TYPE: Record<string, React.ComponentType<{ className?: string }>> = {
  task: CheckSquare,
  contact: User,
  event: CalendarDays,
  doc: FileText,
  email: Mail,
  decision: Scale,
  issue: Flag,
  rock: Mountain,
  metric: BarChart3,
  action: Zap,
  preference: Star,
  pattern: Repeat,
  goal: Target,
  value: Gem,
};

function ResourceIcon({ type, className }: { type?: string | null; className?: string }) {
  const Icon = ICON_FOR_TYPE[type || ""] || Lightbulb;
  return <Icon className={className} />;
}

export default function Memory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [results, setResults] = useState<MemoryResult[]>([]);
  const [links, setLinks] = useState<MemoryLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showLearning, setShowLearning] = useState(false);

  const fetchMemories = useCallback(async (q: string, resourceType: string) => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/memory-search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: accessToken ? `Bearer ${accessToken}` : "",
        },
        body: JSON.stringify({
          query: q,
          resource_type: resourceType === "all" ? null : resourceType,
          limit: 24,
          mode: q.trim() ? "all" : "keyword",
        }),
      });
      const json = (await res.json()) as { results?: MemoryResult[]; links?: MemoryLink[]; error?: string };
      if (json.error) throw new Error(json.error);
      setResults(json.results || []);
      setLinks(json.links || []);
    } catch (e) {
      toast({ title: "Memory search failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchMemories(query, filter);
  }, [filter, fetchMemories]);

  const debouncedSearch = useMemo(() => {
    let t: ReturnType<typeof setTimeout>;
    return (q: string) => {
      clearTimeout(t);
      t = setTimeout(() => fetchMemories(q, filter), 250);
    };
  }, [filter, fetchMemories]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    debouncedSearch(value);
  };

  const deleteMemory = async (id: string) => {
    const { error } = await supabase.from("wisdom_memories" as any).delete().eq("id", id);
    if (error) {
      toast({ title: "Could not delete memory", description: error.message, variant: "destructive" });
      return;
    }
    setResults((prev) => prev.filter((r) => r.id !== id));
    toast({ title: "Memory deleted" });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const linksFor = (id: string) => links.filter((l) => l.target && l.id /* source matches later */).filter((l) => l.target?.id === id);

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30 px-4 py-3">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button onClick={() => navigate("/")} className="p-2 -ml-2 rounded-xl hover:bg-muted/50">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="w-5 h-5" /> Memory
          </h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <section className="rounded-lg border border-border/40 bg-card/40">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowLearning((open) => !open)}
            className="h-auto w-full justify-between rounded-lg px-4 py-3 text-left"
            aria-expanded={showLearning}
          >
            <span className="flex min-w-0 items-center gap-3">
              <Info className="h-5 w-5 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-medium">How Ozlon learns</span>
                <span className="block text-xs font-normal text-muted-foreground">See how your information becomes useful.</span>
              </span>
            </span>
            {showLearning ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          {showLearning && (
            <div className="grid gap-3 border-t border-border/30 px-4 py-4 sm:grid-cols-2">
              <LearningStep icon={FileText} title="Collected" text="Chats, documents, connected services, and Life OS updates provide context." />
              <LearningStep icon={Database} title="Organized" text="Useful facts, decisions, tasks, people, and patterns are saved to your private memory." />
              <LearningStep icon={Sparkles} title="Used" text="Relevant memories return during chats, daily signals, reviews, and planned actions." />
              <LearningStep icon={ShieldCheck} title="Controlled by you" text="Search what is remembered, open its source when available, or delete it here." />
            </div>
          )}
        </section>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search everything Ozlon remembers..."
            className="w-full pl-10 pr-10 py-3 rounded-2xl bg-muted/40 border border-border/30 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
          />
          {query && (
            <button
              onClick={() => handleQueryChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted/60"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card/60 text-muted-foreground border-border/40 hover:bg-muted/40"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Results */}
        {loading && results.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted/30 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {!loading && results.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <Brain className="w-12 h-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground">No memories found yet.</p>
            <p className="text-xs text-muted-foreground/70 max-w-xs mx-auto">
              Ask Ozlon to remember something, or use any business tool — tasks, emails, events, and decisions will appear here automatically.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {results.map((r) => {
            const isExpanded = expanded.has(r.id);
            const type = (r.resource_type || r.type || "fact") as string;
            const links = linksFor(r.id);
            return (
              <div
                key={`${r.source}-${r.id}`}
                className="group p-4 rounded-2xl border border-border/30 bg-card/40 hover:bg-card/60 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 p-2 rounded-xl bg-muted/50 text-muted-foreground">
                    <ResourceIcon type={type} className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-medium truncate">{r.summary || r.content || "Untitled memory"}</h3>
                      {r.similarity !== null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                          {Math.round(r.similarity * 100)}% match
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                      <Tag className="w-3 h-3" />
                      <span className="capitalize">{type}</span>
                      {r.source_tool && <span>· {r.source_tool}</span>}
                      <Calendar className="w-3 h-3 ml-1" />
                      <span>{formatDate(r.updated_at || r.created_at)}</span>
                    </div>

                    {(r.content && r.content !== r.summary) && (
                      <p className={cn("text-sm text-muted-foreground mt-2", !isExpanded && "line-clamp-2")}>
                        {r.content}
                      </p>
                    )}

                    {r.source === "memory" && (r.content || "") !== (r.summary || "") && (
                      <button
                        onClick={() => toggleExpand(r.id)}
                        className="mt-1 text-xs text-primary flex items-center gap-1 hover:underline"
                      >
                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        {isExpanded ? "Show less" : "Show more"}
                      </button>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      {r.external_url && (
                        <a
                          href={r.external_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-muted/50 hover:bg-muted text-foreground"
                        >
                          <ExternalLink className="w-3 h-3" /> Open
                        </a>
                      )}
                      {r.external_id && !r.external_url && (
                        <span className="text-xs px-2 py-1 rounded-lg bg-muted/50 text-muted-foreground">
                          ID: {r.external_id.slice(0, 24)}
                        </span>
                      )}
                      {links.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-primary/10 text-primary">
                          <LinkIcon className="w-3 h-3" /> {links.length} link{links.length > 1 ? "s" : ""}
                        </span>
                      )}
                      <button
                        onClick={() => deleteMemory(r.id)}
                        className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete memory"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LearningStep({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 rounded-md bg-muted/60 p-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
