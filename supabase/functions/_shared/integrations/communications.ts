// Communications integration — exposes the read-only inbox aggregator and
// daily digest to the AI orchestrator. Both are safe (read, cheap-to-moderate)
// and return the normalized envelope `{ ok, data, diagnostics }`, so the
// dispatcher's formatter sees a stable shape.

import type { IntegrationManifest } from "./types.ts";

interface AggregateData {
  stream?: Array<{
    fromName?: string;
    channelLabel?: string;
    subject?: string;
    preview?: string;
    isUnread?: boolean;
    needsReply?: boolean;
  }>;
  priorities?: Array<{ who?: string; channelLabel?: string; what?: string }>;
  sourceCounts?: Record<string, number>;
}

interface DigestData {
  heroLine?: string;
  subLine?: string;
  briefScript?: string;
  priorities?: Array<{ who?: string; channelLabel?: string; what?: string }>;
}

function pickData<T>(raw: unknown): T {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (r.data && typeof r.data === "object") return r.data as T;
    return r as T;
  }
  return {} as T;
}

export const communicationsIntegration: IntegrationManifest = {
  id: "communications",
  displayName: "Unified Communications",
  edgeFunction: "communications-aggregate",
  envelope: "flat",
  tools: [
    {
      name: "communications_inbox",
      description:
        "Fetch the user's unified inbox across Gmail, Slack, and GoHighLevel (SMS + voicemail). Returns a stream of recent messages, the top priorities, and per-source counts. Use this when the user asks about their inbox, what's new, what needs a reply, or to summarize communications. Read-only.",
      schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      action: "fetch",
      mapArgs: () => ({}),
      sideEffect: "read",
      cost: "moderate",
      formatter: (raw, _args) => {
        const d = pickData<AggregateData>(raw);
        const stream = d.stream ?? [];
        const priorities = d.priorities ?? [];
        const counts = d.sourceCounts ?? {};
        const countsLine = Object.entries(counts)
          .filter(([, v]) => (v as number) > 0)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ") || "none";
        const prioLines = priorities.length
          ? priorities
              .slice(0, 5)
              .map((p, i) => `${i + 1}. ${p.who ?? "?"} (${p.channelLabel ?? "?"}): ${p.what ?? ""}`)
              .join("\n")
          : "(no urgent items)";
        const recent = stream
          .slice(0, 8)
          .map((m) => {
            const flags = [m.isUnread ? "unread" : null, m.needsReply ? "needs-reply" : null]
              .filter(Boolean)
              .join(", ");
            const subj = m.subject ? ` — ${m.subject}` : "";
            return `• ${m.fromName ?? "?"} [${m.channelLabel ?? "?"}]${subj}${flags ? ` (${flags})` : ""}: ${(m.preview ?? "").slice(0, 140)}`;
          })
          .join("\n") || "(empty)";
        return `Inbox snapshot (${countsLine}).\n\nTop priorities:\n${prioLines}\n\nRecent:\n${recent}`;
      },
    },
  ],
};

export const communicationsDigestIntegration: IntegrationManifest = {
  id: "communications-digest",
  displayName: "Communications Daily Digest",
  edgeFunction: "communications-digest",
  envelope: "flat",
  tools: [
    {
      name: "communications_digest",
      description:
        "Get the chief-of-staff style daily digest for the user's inbox: a hero line, a sub line, a short voice-ready brief script, and the top 3 priorities. Use when the user asks 'brief me', 'catch me up', or 'what should I know today'. Read-only.",
      schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      action: "fetch",
      mapArgs: () => ({}),
      sideEffect: "read",
      cost: "moderate",
      formatter: (raw, _args) => {
        const d = pickData<DigestData>(raw);
        const prios = (d.priorities ?? [])
          .slice(0, 3)
          .map((p, i) => `${i + 1}. ${p.who ?? "?"} (${p.channelLabel ?? "?"}): ${p.what ?? ""}`)
          .join("\n") || "(none)";
        return [
          `Hero: ${d.heroLine ?? "(none)"}`,
          `Sub: ${d.subLine ?? ""}`,
          `Brief script: ${d.briefScript ?? ""}`,
          `Priorities:\n${prios}`,
        ].join("\n\n");
      },
    },
  ],
};
