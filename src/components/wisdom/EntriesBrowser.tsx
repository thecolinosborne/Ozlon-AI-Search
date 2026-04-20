import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import { wisdomService, type SearchResultItem } from "@/services/wisdomService";

type Entry = {
  id: string;
  title: string;
  content: string;
  category: string;
  domain: string;
  source_person: string;
  tags: string[] | null;
};

export const EntriesBrowser = ({ refreshKey }: { refreshKey?: number }) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [domain, setDomain] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultItem[] | null>(null);

  useEffect(() => {
    wisdomService.getEntries().then((d) => setEntries(d as Entry[]));
  }, [refreshKey]);

  const domains = useMemo(() => {
    const s = new Set(entries.map((e) => e.domain).filter(Boolean));
    return ["all", ...Array.from(s)];
  }, [entries]);

  const categories = useMemo(() => {
    const s = new Set(entries.map((e) => e.category).filter(Boolean));
    return ["all", ...Array.from(s)];
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (domain !== "all" && e.domain !== domain) return false;
      if (category !== "all" && e.category !== category) return false;
      return true;
    });
  }, [entries, domain, category]);

  const runSemanticSearch = async () => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const { results } = await wisdomService.search(query, { scope: "knowledge", match_count: 15 });
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  };

  const display = searchResults
    ? searchResults
    : filtered.map((e) => ({
        id: e.id,
        type: "knowledge" as const,
        title: `${e.title} — ${e.source_person}`,
        content: e.content,
        similarity: 1,
        weighted_score: 1,
        metadata: { category: e.category, domain: e.domain, tags: e.tags },
      }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Semantic search (e.g. 'leverage', 'pricing strategy')…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSemanticSearch()}
            className="pl-9"
          />
        </div>
        <button
          onClick={runSemanticSearch}
          disabled={searching}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center gap-2"
        >
          {searching && <Loader2 className="w-4 h-4 animate-spin" />}
          Search
        </button>
        {searchResults && (
          <button
            onClick={() => {
              setSearchResults(null);
              setQuery("");
            }}
            className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {!searchResults && (
        <div className="flex flex-wrap gap-2">
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {domains.map((d) => (
              <option key={d} value={d}>{d === "all" ? "All domains" : d}</option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground self-center">
            {filtered.length} of {entries.length}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {display.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">
            No entries yet. Install a Wisdom Pack or add a source.
          </div>
        ) : (
          display.map((r) => (
            <div key={r.id} className="rounded-xl border border-border/40 bg-card/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold">{r.title}</div>
                {searchResults && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {(r.similarity * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {(r.metadata as { category?: string; domain?: string }).category} ·{" "}
                {(r.metadata as { category?: string; domain?: string }).domain}
              </div>
              <div className="text-xs text-foreground/80 leading-relaxed mt-2">{r.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
