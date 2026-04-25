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
  ],
};
