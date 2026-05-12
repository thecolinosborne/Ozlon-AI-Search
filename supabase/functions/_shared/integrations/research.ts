// Research subsystem manifest — universal web search/scrape/map.
// Routes to supabase/functions/research, which fans out to Tavily + Firecrawl
// in parallel and returns a normalized result shape.

import type { IntegrationManifest } from "./types.ts";
import { formatList, formatRecord } from "./_formatters.ts";

export const researchIntegration: IntegrationManifest = {
  id: "research",
  displayName: "Web Research",
  edgeFunction: "research",
  envelope: "nested",
  tools: [
    {
      name: "web_search",
      description:
        "Search the live web. Fans out to Tavily + Firecrawl in parallel, deduplicates, and returns a normalized list of results (url, title, snippet, publishedAt?, score, source). Use this for ANY general web lookup, news, fact-check, current events, competitor research, or 'find me X online' request. Prefer this over older deep_research/scrape_events tools.",
      action: "web_search",
      sideEffect: "external_call",
      cost: "moderate",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query." },
          maxResults: { type: "number", description: "Max results to return (default 10, cap 25)." },
          recencyDays: { type: "number", description: "Optional: bias toward results from last N days." },
          includeDomains: { type: "array", items: { type: "string" } },
          excludeDomains: { type: "array", items: { type: "string" } },
        },
        required: ["query"],
      },
      mapArgs: (a) => ({
        query: a.query,
        maxResults: a.maxResults,
        recencyDays: a.recencyDays,
        includeDomains: a.includeDomains,
        excludeDomains: a.excludeDomains,
      }),
      formatter: (data) =>
        formatList(data, "results", { title: "title", sub: "url", meta: "source" }, {
          label: "web results",
          max: 15,
        }),
    },
    {
      name: "web_scrape",
      description:
        "Fetch and clean a single URL into markdown via Firecrawl. Use when you have a specific page to read.",
      action: "web_scrape",
      sideEffect: "external_call",
      cost: "moderate",
      schema: {
        type: "object",
        properties: {
          url: { type: "string" },
          onlyMainContent: { type: "boolean" },
        },
        required: ["url"],
      },
      mapArgs: (a) => ({ url: a.url, onlyMainContent: a.onlyMainContent }),
      formatter: (data) =>
        formatRecord(data, {
          URL: "url",
          Title: "title",
          Content: "markdown",
        }, { label: "Scraped page" }),
    },
    {
      name: "web_map",
      description:
        "List URLs on a domain via Firecrawl. Use to discover the structure of a site before scraping.",
      action: "web_map",
      sideEffect: "external_call",
      cost: "cheap",
      schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Root URL of the domain." },
          search: { type: "string", description: "Optional keyword to filter URLs." },
          limit: { type: "number" },
        },
        required: ["url"],
      },
      mapArgs: (a) => ({ url: a.url, search: a.search, limit: a.limit }),
      formatter: (data) =>
        formatList(data, "links", { title: "url" }, { label: "URLs", max: 30 }),
    },
    {
      name: "web_enrich",
      description:
        "Stage-2 enrichment: take URLs from a prior web_search and fetch full markdown for the ones you actually want to read. Batched parallel scrape (max 8 URLs). Use after web_search when you need the body of specific results, NOT before.",
      action: "web_enrich",
      sideEffect: "external_call",
      cost: "moderate",
      schema: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: "URLs to fetch full content for (max 8).",
          },
        },
        required: ["urls"],
      },
      mapArgs: (a) => ({ urls: a.urls }),
      formatter: (data) => {
        const docs = (data as { documents?: Array<{ url: string; title?: string; markdown?: string; error?: string }> })?.documents ?? [];
        if (docs.length === 0) return "No documents enriched.";
        return docs.map((d) => d.error
          ? `❌ ${d.url}: ${d.error}`
          : `📄 ${d.title || d.url}\n${d.url}\n${(d.markdown ?? "").slice(0, 1500)}`
        ).join("\n\n---\n\n");
      },
    },
    {
      name: "web_answer",
      description:
        "One-shot answer with citations. Searches the web, fetches the top 3 sources, and synthesizes a concise answer with inline [1][2] citations. Use for direct user questions like 'what is the current X' or 'who won Y' when you want a finished answer instead of raw results. Slower than web_search but saves round-trips.",
      action: "web_answer",
      sideEffect: "external_call",
      cost: "expensive",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The user's question." },
          contextHint: { type: "string", description: "Optional context from the conversation to disambiguate the query." },
        },
        required: ["query"],
      },
      mapArgs: (a) => ({ query: a.query, contextHint: a.contextHint }),
      formatter: (data) => {
        const d = data as { answer?: string; citations?: Array<{ index: number; url: string; title: string }> };
        if (!d?.answer) return "No answer synthesized.";
        const cites = (d.citations ?? []).map((c) => `[${c.index}] ${c.title} — ${c.url}`).join("\n");
        return cites ? `${d.answer}\n\nSources:\n${cites}` : d.answer;
      },
    },
    {
      name: "web_investigate",
      description:
        "Multi-hop autonomous research. Decomposes a complex question into 2-5 focused sub-queries (planned by Gemini), runs them in parallel via web_search, auto-enriches the top hits, synthesizes a structured answer with citations, and self-critiques for gaps (firing one targeted follow-up if needed). Use for COMPARATIVE, MULTI-FACETED, or CROSS-SOURCE questions like 'compare X vs Y', 'give me a full briefing on Z', 'what's happening with A across pricing/reviews/news'. One call replaces 4-8 manual rounds. Hard budget: 5 sub-queries, 8 enriches, 30s wall-clock. Falls back to web_answer if budgets exceeded.",
      action: "web_investigate",
      sideEffect: "external_call",
      cost: "expensive",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The user's complex question." },
          contextHint: { type: "string", description: "Optional context from the conversation." },
        },
        required: ["query"],
      },
      mapArgs: (a) => ({ query: a.query, contextHint: a.contextHint }),
      formatter: (data) => {
        const d = data as {
          answer?: string;
          citations?: Array<{ index: number; url: string; title: string }>;
          sub_queries?: Array<{ query: string; intent: string }>;
          confidence?: number;
          gaps?: string[];
        };
        if (!d?.answer) return "No investigation completed.";
        const subs = (d.sub_queries ?? []).map((s, i) => `  ${i + 1}. [${s.intent}] ${s.query}`).join("\n");
        const cites = (d.citations ?? []).map((c) => `[${c.index}] ${c.title} — ${c.url}`).join("\n");
        const gaps = d.gaps && d.gaps.length > 0 ? `\n\nKnown gaps:\n${d.gaps.map((g) => `• ${g}`).join("\n")}` : "";
        const conf = typeof d.confidence === "number" ? ` (confidence: ${(d.confidence * 100).toFixed(0)}%)` : "";
        return `${d.answer}${conf}\n\nSub-queries run:\n${subs}${cites ? `\n\nSources:\n${cites}` : ""}${gaps}`;
      },
    },
    {
      name: "web_recall",
      description:
        "Recall the user's PRIOR investigations on similar questions. Cheap semantic search over the user's research history (last 7 days by default). Use BEFORE web_investigate when the user asks something they may have asked before, or when they say 'what did we find about X' / 'remind me about Y'. Returns prior answers with confidence + age so you can offer to reuse or refresh.",
      action: "web_recall",
      sideEffect: "read",
      cost: "cheap",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The question to look up." },
          maxAgeHours: { type: "number", description: "Search window in hours (default 168 = 7 days, max 720)." },
          threshold: { type: "number", description: "Similarity threshold 0.5–0.99 (default 0.82)." },
        },
        required: ["query"],
      },
      mapArgs: (a) => ({ query: a.query, maxAgeHours: a.maxAgeHours, threshold: a.threshold }),
      formatter: (data) => {
        const d = data as { matches?: Array<{ plan_id: string; original_question: string; answer: string; confidence: number; similarity: number; age_hours: number; gaps: string[] }> };
        const matches = d?.matches ?? [];
        if (matches.length === 0) return "No prior investigation found for this question.";
        return matches.map((m, i) =>
          `${i + 1}. "${m.original_question}" (${(m.similarity * 100).toFixed(0)}% match, ${m.age_hours}h ago, confidence ${(m.confidence * 100).toFixed(0)}%)\n${m.answer.slice(0, 600)}${m.answer.length > 600 ? "…" : ""}`
        ).join("\n\n---\n\n");
      },
    },
    {
      name: "personal_research",
      description:
        "DECISION-GRADE research that fuses live web findings with the user's own Wisdom Engine memories (principles, prior decisions, preferences, goals). Use this when the user asks anything where THEIR context matters: 'should I…', 'what do you think about…', 'help me decide…', 'research X for me', 'who is X' (when they may know them), 'is this a good idea', or any open question where remembering what they care about would change the answer. ALWAYS prefer this over web_investigate when the user is asking for a recommendation, opinion, or decision. Returns: a synthesized answer with web [n] and personal [Wn] citations, a confidence score, follow-up questions, and a persisted reportId so it can be saved as a living thread. The frontend renders a Research Card automatically.",
      action: "personal_research",
      sideEffect: "external_call",
      cost: "expensive",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The user's question, exactly as asked or lightly cleaned." },
          contextHint: { type: "string", description: "Optional context from the conversation to disambiguate." },
          saveAsThread: { type: "boolean", description: "Persist as a living thread the user can re-open later. Default false; set true if user says 'save this' or 'remember this research'." },
        },
        required: ["query"],
      },
      mapArgs: (a) => ({
        query: a.query,
        contextHint: a.contextHint,
        saveAsThread: a.saveAsThread === true,
      }),
      formatter: (data) => {
        const d = data as {
          answer?: string;
          confidence?: number;
          sources?: Array<{ source_type: string; index: number; url?: string; title?: string }>;
          personalContext?: string[];
          followUps?: string[];
        };
        if (!d?.answer) return "No research synthesized.";
        const conf = typeof d.confidence === "number" ? ` (confidence ${(d.confidence * 100).toFixed(0)}%)` : "";
        const web = (d.sources ?? []).filter((s) => s.source_type === "web")
          .map((s) => `[${s.index}] ${s.title ?? s.url} — ${s.url ?? ""}`).join("\n");
        const wisdom = (d.sources ?? []).filter((s) => s.source_type === "wisdom")
          .map((s) => `[W${s.index}] ${s.title ?? ""}`).join("\n");
        const ctx = d.personalContext && d.personalContext.length ? `\n\nPersonal context:\n${d.personalContext.map((c) => `• ${c}`).join("\n")}` : "";
        const fu = d.followUps && d.followUps.length ? `\n\nFollow-ups:\n${d.followUps.map((f) => `• ${f}`).join("\n")}` : "";
        return `${d.answer}${conf}${ctx}${web ? `\n\nSources:\n${web}` : ""}${wisdom ? `\n${wisdom}` : ""}${fu}`;
      },
    },
  ],
};
