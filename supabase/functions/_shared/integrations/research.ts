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
  ],
};
