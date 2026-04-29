import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSignals, type SignalMoment } from "@/hooks/useSignals";
import { useCommunicationsFeed, type PriorityItem } from "@/hooks/useCommunicationsFeed";
import { useCurrentMode } from "@/hooks/useCurrentMode";
import { useSkills } from "@/hooks/useSkills";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * useStack — the unified actionable inbox.
 *
 * Merges signal_moments + communications priorities + user captures into a
 * single normalized list of StackItems, ranks them with the urgency engine,
 * and exposes uniform actions (complete/snooze/dismiss/runAgent) that route
 * to the correct underlying source. Phase 1: pure client merge, no schema
 * change. Read-only projection for comm rows; writes only to signal_moments.
 */

export type StackSource =
  | "signal"
  | "comm"
  | "capture"
  | "voice"
  | "agent"
  | "wisdom"
  | "task";

export type StackUrgency = "high" | "medium" | "low";
export type StackStatus = "open" | "snoozed" | "done" | "dismissed";

export interface StackAgentSuggestion {
  skillSlug?: string;
  label: string;
  autoIntent: string;
  estSeconds?: number;
}

export interface StackItem {
  /** Synthetic, stable across re-renders: `${source}:${sourceId}` */
  id: string;
  source: StackSource;
  sourceId: string;
  headline: string;
  subline?: string;
  who?: string;
  channel?: string;
  /** Raw 0..1 ranking score (for sorting & grouping). */
  score: number;
  urgency: StackUrgency;
  status: StackStatus;
  createdAt: Date;
  agentSuggestion?: StackAgentSuggestion;
  primaryAction:
    | { kind: "reply"; payload: PriorityItem }
    | { kind: "run_skill"; payload: { slug: string; intent: string; signalId: string } }
    | { kind: "open_link"; payload: { href: string } }
    | { kind: "mark_done" };
  origin: { route: string; deepLink?: string };
  /** Other source IDs collapsed into this row (Phase 1 dedup). */
  signalRefs: string[];
  /** Underlying objects for callers that need source-specific data. */
  raw: { signal?: SignalMoment; priority?: PriorityItem };
}

// ---------- urgency engine ----------

const SOURCE_WEIGHT: Record<StackSource, number> = {
  signal: 1.0,
  comm: 0.85,
  voice: 0.8,
  capture: 0.7,
  agent: 0.65,
  task: 0.6,
  wisdom: 0.5,
};

const COMM_URGENCY_SCORE: Record<NonNullable<PriorityItem["urgency"]>, number> = {
  high: 0.9,
  medium: 0.6,
  low: 0.35,
};

function timeProximity(_dueAt: Date | null): number {
  // Placeholder — real due_at lands in Phase 2. For now neutral.
  return 0.5;
}

function modeFit(score: number, mode: string | null): number {
  if (mode === "focus") return score < 0.6 ? 0.2 : 1;
  return 0.7;
}

function bandFor(score: number): StackUrgency {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

// ---------- mappers ----------

function mapSignal(
  m: SignalMoment,
  mode: string | null,
  skillMatch?: { slug: string; name: string },
): StackItem {
  const base =
    0.35 * (m.salience ?? 0.5) +
    0.2 * timeProximity(m.expires_at ? new Date(m.expires_at) : null) +
    0.15 * SOURCE_WEIGHT.signal +
    0.1 * modeFit(m.salience ?? 0.5, mode) +
    0.05 * 0; // streak placeholder
  const score = Math.min(1, base);
  const md = (m.metadata ?? {}) as Record<string, unknown>;
  const sigType = (md.signal_type as string) ?? null;

  const isCapture = m.kind === "user_created";
  const source: StackSource = isCapture ? "capture" : "signal";
  const intent = m.suggested_direction || m.headline;

  const primary: StackItem["primaryAction"] = skillMatch
    ? { kind: "run_skill", payload: { slug: skillMatch.slug, intent, signalId: m.id } }
    : { kind: "mark_done" };

  return {
    id: `${source}:${m.id}`,
    source,
    sourceId: m.id,
    headline: m.headline,
    subline: m.reason ?? m.suggested_direction ?? undefined,
    who: undefined,
    channel: sigType ?? m.kind,
    score,
    urgency: bandFor(score),
    status: m.status === "live" ? "open" : (m.status as StackStatus),
    createdAt: new Date(m.created_at),
    agentSuggestion: skillMatch
      ? { skillSlug: skillMatch.slug, label: `Run ${skillMatch.name}`, autoIntent: intent }
      : undefined,
    primaryAction: primary,
    origin: { route: "/signals", deepLink: `/?intent=${encodeURIComponent(intent)}&signal=${m.id}` },
    signalRefs: [],
    raw: { signal: m },
  };
}

function mapPriority(p: PriorityItem, mode: string | null): StackItem {
  const base =
    0.35 * (p.urgency ? COMM_URGENCY_SCORE[p.urgency] : 0.5) +
    0.2 * timeProximity(null) +
    0.15 * SOURCE_WEIGHT.comm +
    0.1 * modeFit(p.urgency === "high" ? 0.9 : 0.5, mode) +
    0.05 * 0;
  const score = Math.min(1, base);

  return {
    id: `comm:${p.id}`,
    source: "comm",
    sourceId: p.id,
    headline: p.what,
    subline: p.reason,
    who: p.who,
    channel: p.channelLabel,
    score,
    urgency: bandFor(score),
    status: "open",
    createdAt: new Date(),
    agentSuggestion: undefined,
    primaryAction: { kind: "reply", payload: p },
    origin: { route: "/communications" },
    signalRefs: [],
    raw: { priority: p },
  };
}

// ---------- dedup ----------

function dedupe(items: StackItem[]): StackItem[] {
  const out: StackItem[] = [];
  const seenHeadlines = new Map<string, StackItem>();
  for (const it of items) {
    const key = it.headline.trim().toLowerCase().slice(0, 120);
    const existing = seenHeadlines.get(key);
    if (existing) {
      // Comm row wins over signal/capture for the same headline (it's actionable).
      if (it.source === "comm" && existing.source !== "comm") {
        existing.signalRefs.push(it.sourceId);
        const idx = out.indexOf(existing);
        out[idx] = { ...it, signalRefs: [...existing.signalRefs] };
        seenHeadlines.set(key, out[idx]);
      } else {
        existing.signalRefs.push(it.sourceId);
      }
      continue;
    }
    seenHeadlines.set(key, it);
    out.push(it);
  }
  return out;
}

// ---------- grouping ----------

export interface StackGroups {
  now: StackItem[];
  soon: StackItem[];
  later: StackItem[];
  snoozed: StackItem[];
  doneToday: StackItem[];
}

function groupItems(items: StackItem[]): StackGroups {
  const now: StackItem[] = [];
  const soon: StackItem[] = [];
  const later: StackItem[] = [];
  const snoozed: StackItem[] = [];
  const doneToday: StackItem[] = [];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  for (const it of items) {
    if (it.status === "snoozed") snoozed.push(it);
    else if (it.status === "done" || it.status === "dismissed") {
      if (it.createdAt >= startOfToday) doneToday.push(it);
    } else if (it.urgency === "high") now.push(it);
    else if (it.urgency === "medium") soon.push(it);
    else later.push(it);
  }
  return { now, soon, later, snoozed, doneToday };
}

// ---------- hook ----------

export interface UseStackResult {
  items: StackItem[];
  groups: StackGroups;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Mark item complete (optimistic; routes to signal or comm). */
  complete: (item: StackItem) => Promise<void>;
  /** Snooze for N minutes from now. Phase 1 stores hint locally; Phase 2 persists. */
  snooze: (item: StackItem, minutes: number) => Promise<void>;
  /** Dismiss without acting. */
  dismiss: (item: StackItem) => Promise<void>;
  /** Run the matched agent skill via deep-link. */
  runAgent: (item: StackItem) => void;
  /** Open the source context (comm thread, signal detail). */
  openSource: (item: StackItem) => void;
  /** Bulk variants. */
  completeMany: (items: StackItem[]) => Promise<void>;
  snoozeMany: (items: StackItem[], minutes: number) => Promise<void>;
  dismissMany: (items: StackItem[]) => Promise<void>;
  /** Cleared today count from doneToday. */
  clearedToday: number;
}

export function useStack(): UseStackResult {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { moments, respond, refresh: refreshSignals } = useSignals();
  const { digest, refetch: refetchComms } = useCommunicationsFeed();
  const { mode } = useCurrentMode();
  const { skills } = useSkills();

  const skillIndex = useMemo(() => {
    return skills
      .filter((s) => s.installed && s.enabled)
      .map((s) => {
        const triggers =
          (s.manifest as { triggers?: Array<{ type: string; match: string[] | string }> })
            ?.triggers ?? [];
        const keywords = triggers
          .filter((t) => t.type === "keyword" && Array.isArray(t.match))
          .flatMap((t) => t.match as string[])
          .map((k) => k.toLowerCase());
        return { slug: s.slug, name: s.name, keywords };
      })
      .filter((s) => s.keywords.length > 0);
  }, [skills]);

  const matchSkillFor = useCallback(
    (m: SignalMoment) => {
      const hay = `${m.headline} ${m.suggested_direction ?? ""}`.toLowerCase();
      return skillIndex.find((s) => s.keywords.some((k) => hay.includes(k)));
    },
    [skillIndex],
  );

  const items = useMemo<StackItem[]>(() => {
    const sigItems = moments.map((m) => mapSignal(m, mode, matchSkillFor(m)));
    const commItems = (digest?.priorities ?? []).map((p) => mapPriority(p, mode));
    const merged = [...sigItems, ...commItems];
    const deduped = dedupe(merged);
    deduped.sort((a, b) => b.score - a.score);
    return deduped;
  }, [moments, digest?.priorities, mode, matchSkillFor]);

  const groups = useMemo(() => groupItems(items), [items]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshSignals(), Promise.resolve(refetchComms())]);
  }, [refreshSignals, refetchComms]);

  const complete = useCallback(
    async (item: StackItem) => {
      if (item.source === "comm") {
        // Comm priorities are projected read-only; nothing to persist.
        // The Communications page maintains its own hidden-set; we leave it alone.
        return;
      }
      await respond(item.sourceId, item.source === "capture" ? "complete" : "acted");
    },
    [respond],
  );

  const snooze = useCallback(
    async (item: StackItem, minutes: number) => {
      if (item.source === "comm") return;
      if (!user) return;
      const until = new Date(Date.now() + minutes * 60_000).toISOString();
      // Optimistic: drop from local list immediately
      const { error } = await supabase
        .from("signal_moments")
        .update({ snoozed_until: until })
        .eq("id", item.sourceId)
        .eq("user_id", user.id);
      if (error) console.warn("[useStack] snooze error:", error.message);
      await refreshSignals();
    },
    [user, refreshSignals],
  );

  const dismiss = useCallback(
    async (item: StackItem) => {
      if (item.source === "comm") return;
      await respond(item.sourceId, "dismissed");
    },
    [respond],
  );

  const runAgent = useCallback(
    (item: StackItem) => {
      if (item.primaryAction.kind === "run_skill") {
        const { slug, intent, signalId } = item.primaryAction.payload;
        // Mark acted optimistically.
        if (item.source === "signal" || item.source === "capture") {
          void respond(signalId, "acted");
        }
        navigate(
          `/?intent=${encodeURIComponent(intent)}&skill=${slug}&signal=${signalId}&autorun=1`,
        );
      } else if (item.primaryAction.kind === "open_link") {
        window.open(item.primaryAction.payload.href, "_blank", "noopener,noreferrer");
      } else if (item.origin.deepLink) {
        navigate(item.origin.deepLink);
      }
    },
    [navigate, respond],
  );

  const openSource = useCallback(
    (item: StackItem) => {
      if (item.origin.deepLink) {
        navigate(item.origin.deepLink);
      } else {
        navigate(item.origin.route);
      }
    },
    [navigate],
  );

  // Bulk: a single Supabase update for signals; comm items are no-ops in Phase 1.
  const bulkUpdate = useCallback(
    async (items: StackItem[], status: "acted" | "dismissed") => {
      if (!user) return;
      const ids = items
        .filter((it) => it.source === "signal" || it.source === "capture")
        .map((it) => it.sourceId);
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("signal_moments")
        .update({ status })
        .in("id", ids)
        .eq("user_id", user.id);
      if (error) {
        console.warn("[useStack] bulkUpdate error:", error.message);
      }
    },
    [user],
  );

  const completeMany = useCallback(
    async (items: StackItem[]) => {
      await bulkUpdate(items, "acted");
      await refreshSignals();
    },
    [bulkUpdate, refreshSignals],
  );

  const dismissMany = useCallback(
    async (items: StackItem[]) => {
      await bulkUpdate(items, "dismissed");
      await refreshSignals();
    },
    [bulkUpdate, refreshSignals],
  );

  const snoozeMany = useCallback(
    async (items: StackItem[], minutes: number) => {
      if (!user) return;
      const ids = items
        .filter((it) => it.source === "signal" || it.source === "capture")
        .map((it) => it.sourceId);
      if (ids.length === 0) return;
      const until = new Date(Date.now() + minutes * 60_000).toISOString();
      const { error } = await supabase
        .from("signal_moments")
        .update({ snoozed_until: until })
        .in("id", ids)
        .eq("user_id", user.id);
      if (error) console.warn("[useStack] snoozeMany error:", error.message);
      await refreshSignals();
    },
    [user, refreshSignals],
  );

  return {
    items,
    groups,
    loading: false,
    refresh,
    complete,
    snooze,
    dismiss,
    runAgent,
    openSource,
    completeMany,
    snoozeMany,
    dismissMany,
    clearedToday: groups.doneToday.length,
  };
}
