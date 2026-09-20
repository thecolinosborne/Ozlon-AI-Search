import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Search, Sparkles, Star, Mail, Paperclip, MessageSquare, Loader2, UserPlus, Pencil, Trash2, Download, Phone, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { ContactEditorDialog } from "@/components/people/ContactEditorDialog";
import { deleteContact, importFromGhl, isGhlConnected, toggleStar } from "@/services/contactsService";

type Entity = {
  id: string;
  display_name: string;
  entity_type: string;
  primary_email: string | null;
  primary_phone?: string | null;
  company?: string | null;
  notes?: string | null;
  source?: string | null;
  external_ids?: Record<string, string> | null;
  importance_score: number;
  last_interaction_at: string | null;
  interaction_count: number;
  channel_counts: Record<string, number>;
  starred: boolean;
  relationship_summary: string | null;
};

type TimelineItem = { kind: string; at: string; data: any };

function initials(name: string): string {
  return name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("") || "?";
}

function bucketLabel(score: number): string {
  if (score >= 0.7) return "Inner Circle";
  if (score >= 0.4) return "Active";
  return "Background";
}

export default function People() {
  const { user, session } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [space, setSpace] = useState<{ entity: Entity; timeline: TimelineItem[]; counts: any } | null>(null);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [ghlConnected, setGhlConnected] = useState(false);
  const [importing, setImporting] = useState(false);

  const callFn = async (name: string, opts: { method?: string; body?: any; query?: Record<string, string> } = {}) => {
    const url = new URL(`https://iebmlegqknigeildujyp.supabase.co/functions/v1/${name}`);
    if (opts.query) Object.entries(opts.query).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        "Content-Type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return res.json();
  };

  const loadEntities = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const data = await callFn("entities-aggregate", { query: refresh ? { refresh: "1" } : {} });
      if (data.ok) setEntities(data.entities || []);
      else toast({ title: "Couldn't load people", description: data.error, variant: "destructive" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadSpace = async (entityId: string, summary = false) => {
    setSpaceLoading(true);
    try {
      const data = await callFn("entity-space", { method: "POST", body: { entity_id: entityId, summary } });
      if (data.ok) setSpace({ entity: data.entity, timeline: data.timeline, counts: data.counts });
    } finally {
      setSpaceLoading(false);
    }
  };

  const activeEntity = useMemo(
    () => entities.find((e) => e.id === activeId) || space?.entity || null,
    [entities, activeId, space],
  );

  const openNewContact = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEditContact = (entity: Entity) => {
    setEditing(entity);
    setEditorOpen(true);
  };

  const removeContact = async (entity: Entity) => {
    if (!window.confirm(`Remove ${entity.display_name} from your People list?`)) return;
    try {
      await deleteContact(entity.id);
      setEntities((prev) => prev.filter((e) => e.id !== entity.id));
      if (activeId === entity.id) {
        setActiveId(null);
        setSpace(null);
      }
      toast({ title: "Contact removed", description: "Their record in the connected app was left alone." });
    } catch (e) {
      toast({ title: "Couldn't remove the contact", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const star = async (entity: Entity) => {
    const next = !entity.starred;
    setEntities((prev) => prev.map((e) => (e.id === entity.id ? { ...e, starred: next } : e)));
    try {
      await toggleStar(entity.id, next);
    } catch (e) {
      setEntities((prev) => prev.map((x) => (x.id === entity.id ? { ...x, starred: !next } : x)));
      toast({ title: "Couldn't update", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const runGhlImport = async () => {
    setImporting(true);
    try {
      const { added, updated } = await importFromGhl();
      toast({ title: "GoHighLevel contacts pulled in", description: `${added} new, ${updated} refreshed.` });
      await loadEntities(false);
    } catch (e) {
      toast({ title: "Couldn't reach GoHighLevel", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const refreshList = useCallback(() => { loadEntities(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return;
    isGhlConnected().then(setGhlConnected).catch(() => setGhlConnected(false));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadEntities(false).then(() => {
      // Auto-build on first visit if empty
      if (entities.length === 0) loadEntities(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (activeId) loadSpace(activeId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) =>
      e.display_name.toLowerCase().includes(q) ||
      (e.primary_email || "").toLowerCase().includes(q),
    );
  }, [entities, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, Entity[]> = { "Inner Circle": [], Active: [], Background: [] };
    filtered.forEach((e) => groups[bucketLabel(e.importance_score)].push(e));
    return groups;
  }, [filtered]);

  const ambient = useMemo(() => {
    const top = entities.filter((e) => e.last_interaction_at).slice(0, 3);
    return top;
  }, [entities]);

  const generateSummary = async () => {
    if (!activeId) return;
    setSummarizing(true);
    try { await loadSpace(activeId, true); } finally { setSummarizing(false); }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Sign in to access People.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/communications" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-sm font-medium tracking-tight">People</h1>
            <p className="text-[11px] text-muted-foreground">Your communication layer — organized by who matters, not by app.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => loadEntities(true)} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin")} />
            Sync
          </Button>
        </div>

        {/* Ambient "what you missed" bar */}
        {ambient.length > 0 && (
          <div className="border-t border-border/30 bg-muted/20">
            <div className="max-w-[1600px] mx-auto px-4 py-2 flex items-center gap-2 overflow-x-auto">
              <Sparkles className="h-3 w-3 text-primary shrink-0" />
              <span className="text-[11px] text-muted-foreground shrink-0">Recently:</span>
              {ambient.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setActiveId(e.id)}
                  className="text-[11px] px-2 py-1 rounded-full bg-background border border-border/50 hover:border-primary/50 transition-colors whitespace-nowrap"
                >
                  {e.display_name} · {e.last_interaction_at ? formatDistanceToNow(new Date(e.last_interaction_at), { addSuffix: true }) : ""}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* 3-pane layout */}
      <div className="max-w-[1600px] mx-auto grid grid-cols-1 md:grid-cols-[320px_1fr] lg:grid-cols-[320px_1fr_320px] gap-0">
        {/* Left: People rail */}
        <aside className="border-r border-border/40 h-[calc(100vh-3.5rem)] flex flex-col">
          <div className="p-3 border-b border-border/30">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search people…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm bg-muted/30 border-0 focus-visible:ring-1"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="p-4 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading people…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <p>No people yet.</p>
                <Button variant="link" size="sm" onClick={() => loadEntities(true)} className="mt-2">
                  Build from communications
                </Button>
              </div>
            ) : (
              <div className="py-2">
                {(["Inner Circle", "Active", "Background"] as const).map((group) =>
                  grouped[group].length > 0 && (
                    <div key={group} className="mb-3">
                      <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">{group}</div>
                      {grouped[group].map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setActiveId(e.id)}
                          className={cn(
                            "w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left",
                            activeId === e.id && "bg-muted/60",
                          )}
                        >
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="text-[10px] bg-gradient-to-br from-primary/20 to-primary/5">
                              {initials(e.display_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm truncate font-medium">{e.display_name}</span>
                              {e.starred && <Star className="h-3 w-3 fill-primary text-primary shrink-0" />}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {e.last_interaction_at
                                ? formatDistanceToNow(new Date(e.last_interaction_at), { addSuffix: true })
                                : "no activity"}
                              {e.interaction_count > 1 && ` · ${e.interaction_count}`}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ),
                )}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* Center: Entity Space */}
        <main className="h-[calc(100vh-3.5rem)] flex flex-col">
          {!activeId ? (
            <div className="flex-1 flex items-center justify-center text-center px-6">
              <div className="max-w-md space-y-3">
                <div className="text-sm text-muted-foreground">Select someone to open their Space</div>
                <p className="text-xs text-muted-foreground/70">
                  Each Space brings together every conversation, file, and interaction with that person — across all your channels.
                </p>
              </div>
            </div>
          ) : spaceLoading || !space ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Entity header */}
              <div className="border-b border-border/30 px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent">
                <div className="flex items-start gap-4">
                  <Avatar className="h-14 w-14">
                    <AvatarFallback className="text-base bg-gradient-to-br from-primary/30 to-primary/5">
                      {initials(space.entity.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight">{space.entity.display_name}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {space.entity.primary_email}
                      {space.entity.last_interaction_at && ` · last ${formatDistanceToNow(new Date(space.entity.last_interaction_at), { addSuffix: true })}`}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge variant="secondary" className="text-[10px] font-normal">{space.entity.entity_type}</Badge>
                      {Object.entries(space.entity.channel_counts || {}).map(([ch, n]) => (
                        <Badge key={ch} variant="outline" className="text-[10px] font-normal">{ch} · {String(n)}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <ScrollArea className="flex-1">
                <div className="px-6 py-4 space-y-3 max-w-3xl">
                  {space.timeline.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-12 text-center">
                      No activity in this Space yet.
                    </div>
                  ) : space.timeline.map((item, i) => (
                    <div key={i} className="rounded-xl border border-border/40 bg-card/30 backdrop-blur p-4 hover:border-border/70 transition-colors">
                      <div className="flex items-center gap-2 mb-1">
                        {item.kind === "message" ? (
                          <Mail className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <Paperclip className="h-3 w-3 text-primary" />
                        )}
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {item.kind === "message" ? (item.data.channel || "email") : "attachment"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 ml-auto">
                          {item.at ? formatDistanceToNow(new Date(item.at), { addSuffix: true }) : ""}
                        </span>
                      </div>
                      {item.kind === "message" ? (
                        <>
                          <div className="text-sm font-medium truncate">{item.data.subject || "(no subject)"}</div>
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{item.data.preview || item.data.body_text}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-sm font-medium truncate">{item.data.filename}</div>
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{item.data.summary || `${item.data.mime_type} · ${Math.round((item.data.size_bytes || 0) / 1024)} KB`}</div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </main>

        {/* Right: Context panel (lg only) */}
        <aside className="hidden lg:flex border-l border-border/40 h-[calc(100vh-3.5rem)] flex-col">
          {space ? (
            <ScrollArea className="flex-1">
              <div className="p-5 space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Relationship</h3>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={generateSummary} disabled={summarizing}>
                      {summarizing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                      {space.entity.relationship_summary ? "Regenerate" : "Summarize"}
                    </Button>
                  </div>
                  {space.entity.relationship_summary ? (
                    <p className="text-xs text-foreground/80 leading-relaxed">{space.entity.relationship_summary}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/70 italic">Tap Summarize to generate an AI overview of your relationship.</p>
                  )}
                </div>

                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Activity</h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Messages</span><span>{space.counts.messages}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Attachments</span><span>{space.counts.attachments}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total interactions</span><span>{space.entity.interaction_count}</span></div>
                  </div>
                </div>

                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Quick actions</h3>
                  <div className="space-y-1.5">
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs" asChild>
                      <Link to={`/?prefill=${encodeURIComponent(`Draft a reply to ${space.entity.display_name}`)}`}>
                        <MessageSquare className="h-3 w-3 mr-2" /> Draft reply with AI
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs" asChild>
                      <Link to={`/?prefill=${encodeURIComponent(`What did I last tell ${space.entity.display_name}?`)}`}>
                        <Sparkles className="h-3 w-3 mr-2" /> Ask about this person
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          ) : (
            <div className="p-6 text-xs text-muted-foreground/60 text-center">
              Context appears here when you open a Space.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
