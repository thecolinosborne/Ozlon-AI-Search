import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Brain, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WisdomPackGrid } from "@/components/wisdom/WisdomPackGrid";
import { AddSourcePanel } from "@/components/wisdom/AddSourcePanel";
import { SourceCard } from "@/components/wisdom/SourceCard";
import { EntriesBrowser } from "@/components/wisdom/EntriesBrowser";
import { wisdomService } from "@/services/wisdomService";
import { memoryService, type WisdomMemory } from "@/services/memoryService";
import { Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useSkillObservations } from "@/hooks/useSkillObservations";
import { PrincipleEditor } from "@/components/wisdom/PrincipleEditor";

type Source = {
  id: string;
  person: string;
  title: string;
  type: string;
  entry_count: number;
  created_at: string;
  is_active?: boolean;
};

type Reflection = {
  id: string;
  content: string;
  note_type: string;
  importance: number | null;
  created_at: string;
};

const Wisdom = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get("mode");
  const initialAddTab = initialMode === "upload" || initialMode === "url" ? initialMode : "text";
  const [sources, setSources] = useState<Source[]>([]);
  const [memories, setMemories] = useState<WisdomMemory[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [counts, setCounts] = useState({ sources: 0, entries: 0, memories: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = async () => {
    const [s, m, r, c] = await Promise.all([
      wisdomService.getSources(),
      memoryService.getAllMemories(),
      wisdomService.getReflections(),
      wisdomService.getCounts(),
    ]);
    setSources(s as Source[]);
    setMemories(m);
    setReflections(r as Reflection[]);
    setCounts(c);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    reload();
  }, []);

  const deleteMemory = async (id: string) => {
    if (!confirm("Delete this memory?")) return;
    const ok = await memoryService.deleteMemory(id);
    if (ok) {
      toast({ title: "Memory deleted" });
      reload();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-muted/60 rounded-md"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <Brain className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Wisdom Library</h1>
            <p className="text-[11px] text-muted-foreground font-mono uppercase tracking-[0.15em]">
              {counts.sources} sources · {counts.entries} entries · {counts.memories} memories
            </p>
          </div>
          {(() => {
            const activeCount = sources.filter((s) => s.is_active !== false).length;
            const isLive = activeCount > 0;
            return (
              <div
                className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium border ${
                  isLive
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-muted/40 border-border/40 text-muted-foreground"
                }`}
                title={
                  isLive
                    ? `${activeCount} source${activeCount === 1 ? "" : "s"} influencing routing & responses`
                    : "No sources plugged in — orchestration idle"
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isLive ? "bg-primary animate-pulse" : "bg-muted-foreground/50"
                  }`}
                />
                {isLive ? `Orchestration: Active · ${activeCount} plugged` : "Orchestration: Idle"}
              </div>
            );
          })()}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24">
        <WisdomPackGrid onInstalled={reload} />
        <AddSourcePanel onIngested={reload} defaultTab={initialAddTab} />

        <SkillLoopSection />

        <Tabs defaultValue="sources">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="entries">Entries</TabsTrigger>
            <TabsTrigger value="memories">Memories</TabsTrigger>
            <TabsTrigger value="reflections">Reflections</TabsTrigger>
          </TabsList>

          <TabsContent value="sources" className="space-y-3 mt-4">
            {sources.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-12">
                No sources yet. Install a Wisdom Pack or add your own above.
              </div>
            ) : (
              sources.map((s) => (
                <SourceCard key={s.id} source={s} onDeleted={reload} onChanged={reload} />
              ))
            )}
          </TabsContent>

          <TabsContent value="entries" className="mt-4">
            <EntriesBrowser refreshKey={refreshKey} />
          </TabsContent>

          <TabsContent value="memories" className="space-y-2 mt-4">
            {memories.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-12">
                No memories captured yet.
              </div>
            ) : (
              memories.map((m) => (
                <div key={m.id} className="rounded-xl border border-border/40 bg-card/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                        {m.memory_type}
                      </div>
                      <div className="text-sm font-medium mt-0.5">
                        {m.summary || m.content.slice(0, 80)}
                      </div>
                      {m.summary && m.content !== m.summary && (
                        <div className="text-xs text-foreground/70 mt-1">{m.content}</div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteMemory(m.id)}
                      className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-md text-muted-foreground"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="reflections" className="space-y-2 mt-4">
            {reflections.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-12">
                No reflections synthesized yet.
              </div>
            ) : (
              reflections.map((r) => (
                <div key={r.id} className="rounded-xl border border-border/40 bg-card/30 p-3">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                    {r.note_type}
                  </div>
                  <div className="text-sm leading-relaxed mt-1 italic">{r.content}</div>
                  <div className="text-[10px] text-muted-foreground mt-2">
                    {new Date(r.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

/**
 * SkillLoopSection — Phase 1 surface for the meta-skill.
 * Shows silent capture progress (observations in last 7d) and any active
 * cross-cutting principles. Methodology adapted from "One Skill to Rule Them
 * All" by Eoghan Henn (rebelytics.com), CC BY 4.0.
 */
function SkillLoopSection() {
  const {
    observationCount,
    recent,
    principles,
    deactivatePrinciple,
    activatePrinciple,
    createPrinciple,
    updatePrinciple,
    deletePrinciple,
  } = useSkillObservations();
  const activeCount = principles.filter((p) => p.active).length;

  return (
    <section className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-medium leading-tight">Skill loop</h2>
            <p className="text-[11px] text-muted-foreground/80 font-mono uppercase tracking-[0.15em] mt-0.5">
              {observationCount} observations · 7d · {activeCount} of {principles.length} active
            </p>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
            Recent observations
          </div>
          {recent.slice(0, 5).map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-3 text-xs text-foreground/85 py-1"
            >
              <span className="text-[10px] text-muted-foreground/70 font-mono uppercase w-16 shrink-0">
                {o.kind}
              </span>
              <span className="truncate flex-1">{o.title}</span>
            </div>
          ))}
        </div>
      )}

      <PrincipleEditor
        principles={principles}
        mutators={{
          createPrinciple,
          updatePrinciple,
          deletePrinciple,
          activatePrinciple,
          deactivatePrinciple,
        }}
      />

      {observationCount === 0 && principles.length === 0 && (
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          The system will silently watch your sessions and capture lessons that could
          improve its skills. Nothing is shared, nothing is auto-installed — every
          proposed change requires your approval.
        </p>
      )}
    </section>
  );
}

export default Wisdom;
