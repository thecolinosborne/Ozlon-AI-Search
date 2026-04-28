// Signal Envelope — pure builder
// No network. Caller passes already-loaded data. Cacheable per turn.

import type { Signal, SignalEnvelope, SignalPriority } from "./types.ts";
import { PRIORITY_ORDER } from "./types.ts";
import { classifyIntent } from "./intent.ts";
import { classifyImportance } from "./importance.ts";
import { classifyInteraction } from "./interaction.ts";
import { getEntityTrie, matchEntities, type Entity } from "./entities.ts";

export interface BuildEnvelopeInput {
  userId: string;
  messages: { role: string; content: string }[];
  // Pre-loaded entity index for trie-based matching
  entities: Entity[];
  // Invalidation signature (e.g. integrations.updated_at)
  entitiesSignature: string;
  // Durable defaults from profile / settings
  defaults?: Record<string, { id: string; name: string; kind: string }>;
  // Session-level active selections (e.g. chat_sessions.active_ghl_location_id)
  active?: Record<string, { id: string; name: string; kind: string }>;
}

export function buildSignalEnvelope(input: BuildEnvelopeInput): SignalEnvelope {
  const { userId, messages, entities, entitiesSignature, defaults = {}, active = {} } = input;
  const latest = messages[messages.length - 1]?.content ?? "";
  const recent = messages.slice(-10).map((m) => m.content).join("\n");

  const signals: Signal[] = [];

  // A — Intent
  signals.push(...classifyIntent(latest));

  // B — Context (entities mentioned in conversation, plus active + durable)
  const trie = getEntityTrie(userId, entitiesSignature, entities);
  const matchesLatest = matchEntities(latest, trie);
  const matchesRecent = matchEntities(recent, trie);

  const seen = new Set<string>();
  const pushContext = (e: Entity, priority: SignalPriority) => {
    const k = `context:${e.kind}:${e.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    signals.push({
      bucket: "context",
      priority,
      key: k,
      value: `${e.kind}:${e.name}`,
      payload: { id: e.id, name: e.name, kind: e.kind, ...(e.payload ?? {}) },
    });
  };

  for (const m of matchesLatest) pushContext(m.entity, "direct");
  for (const m of matchesRecent) pushContext(m.entity, "recent");
  for (const [, a] of Object.entries(active)) pushContext(a as Entity, "active");
  for (const [, d] of Object.entries(defaults)) pushContext(d as Entity, "durable");

  // C — Importance
  signals.push(...classifyImportance(latest));

  // D — Confidence
  // Mark contextual entities as 'inferred' confidence when they only come from defaults.
  const hasDirectContext = signals.some((s) => s.bucket === "context" && s.priority === "direct");
  const hasActiveContext = signals.some((s) => s.bucket === "context" && s.priority === "active");
  if (hasDirectContext) {
    signals.push({ bucket: "confidence", priority: "direct", key: "confidence:confirmed", value: "confirmed" });
  } else if (hasActiveContext) {
    signals.push({ bucket: "confidence", priority: "active", key: "confidence:likely", value: "likely" });
  } else if (Object.keys(defaults).length > 0) {
    signals.push({ bucket: "confidence", priority: "durable", key: "confidence:inferred", value: "inferred" });
  } else {
    signals.push({ bucket: "confidence", priority: "uncertain", key: "confidence:missing", value: "missing data" });
  }

  // E — Interaction
  signals.push(...classifyInteraction(latest, messages.length));

  // Sort by priority within each bucket
  signals.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const byBucket = (b: Signal["bucket"]) => signals.filter((s) => s.bucket === b);

  return {
    builtAt: Date.now(),
    signals,
    intent: byBucket("intent"),
    context: byBucket("context"),
    importance: byBucket("importance"),
    confidence: byBucket("confidence"),
    interaction: byBucket("interaction"),
  };
}

/**
 * Pick the highest-priority entity for a given integration kind.
 * Generalizes the GHL account-resolution guardrail.
 */
export function pickAccountByPriority(
  env: SignalEnvelope,
  kind: string,
): { id: string; name: string; priority: SignalPriority } | null {
  const candidates = env.context
    .filter((s) => (s.payload?.kind as string) === kind)
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  if (candidates.length === 0) return null;
  const top = candidates[0];
  return {
    id: top.payload?.id as string,
    name: top.payload?.name as string,
    priority: top.priority,
  };
}
