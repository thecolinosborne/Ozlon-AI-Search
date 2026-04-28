// Signal Envelope — types
// Single source of truth for the 5-bucket signal model.
// Consumers (chat, signals-synthesize, voice) import the type and a renderer.

export type SignalPriority =
  | "direct"      // user explicitly asked for this in the current turn
  | "active"      // current task / workflow already in progress
  | "durable"     // stable user preferences / defaults
  | "contextual"  // account / project / system clearly in scope this turn
  | "recent"      // mentioned in the last few turns
  | "inferred"    // model deduction with reasonable basis
  | "background"  // ambient context, low weight
  | "uncertain";  // missing data / stale / blocked

export type SignalBucket =
  | "intent"        // A — what the user wants (ask | decide | write | execute | fix)
  | "context"       // B — entities / accounts in scope
  | "importance"    // C — urgency / impact (urgent | recurring | revenue | personal | strategic | blocking)
  | "confidence"    // D — confirmed | likely | inferred | stale | missing | blocked
  | "interaction";  // E — concise | deep | advisory | action-first | document | collaborative | execution

export interface Signal {
  bucket: SignalBucket;
  priority: SignalPriority;
  // Short stable key, e.g. "intent:execute", "context:ghl:Daddy Stroller"
  key: string;
  // Human-readable value
  value: string;
  // Optional structured payload (account id, workspace id, etc.)
  payload?: Record<string, unknown>;
}

export interface SignalEnvelope {
  builtAt: number;
  // Signals are sorted by priority (direct → uncertain) within each bucket.
  signals: Signal[];
  // Convenience accessors
  intent: Signal[];
  context: Signal[];
  importance: Signal[];
  confidence: Signal[];
  interaction: Signal[];
}

export const PRIORITY_ORDER: Record<SignalPriority, number> = {
  direct: 0,
  active: 1,
  durable: 2,
  contextual: 3,
  recent: 4,
  inferred: 5,
  background: 6,
  uncertain: 7,
};
