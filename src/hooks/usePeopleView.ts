import { useMemo } from "react";
import type { CommMessage, TriageItem, CommChannel } from "./useCommunicationsFeed";

export type RelationshipState =
  | "warm" // recent two-way exchange
  | "active" // recently received, not yet replied
  | "cooling" // last touch 2-7 days ago
  | "ghosted" // last touch >7 days, awaiting reply
  | "broadcast"; // newsletter / one-way

export interface PersonGroup {
  /** Unique key — fromHandle when present, else fromName */
  key: string;
  name: string;
  handle?: string;
  channels: Set<CommChannel>;
  messages: CommMessage[];
  /** Most recent message in the group */
  latest: CommMessage;
  /** Count of unread messages */
  unreadCount: number;
  /** Count of needs-reply messages */
  needsReplyCount: number;
  /** Highest urgency seen across triage hints in this group */
  topUrgency: TriageItem["urgency"] | null;
  /** Hours since most recent message */
  hoursSinceLast: number;
  /** Inferred relationship state (heuristic — purely client-side) */
  relationship: RelationshipState;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function inferRelationship(
  msgs: CommMessage[],
  hoursSinceLast: number,
  needsReply: number,
): RelationshipState {
  // Newsletter / no-reply senders: handle starts with "noreply" or "no-reply"
  const handle = msgs[0]?.fromHandle?.toLowerCase() ?? "";
  if (
    handle.startsWith("noreply") ||
    handle.startsWith("no-reply") ||
    handle.includes("newsletter") ||
    handle.includes("notifications@")
  ) {
    return "broadcast";
  }

  if (needsReply > 0 && hoursSinceLast < 24) return "active";
  if (hoursSinceLast < 24 && msgs.length >= 2) return "warm";
  if (hoursSinceLast < 24 * 7 && needsReply > 0) return "cooling";
  if (hoursSinceLast >= 24 * 7 && needsReply > 0) return "ghosted";
  if (hoursSinceLast < 24) return "warm";
  return "cooling";
}

export function usePeopleView(
  stream: CommMessage[],
  triageMap: Map<string, TriageItem>,
): PersonGroup[] {
  return useMemo(() => {
    const now = Date.now();
    const groups = new Map<string, PersonGroup>();

    for (const m of stream) {
      const key = (m.fromHandle ?? m.fromName).toLowerCase();
      const existing = groups.get(key);
      if (existing) {
        existing.messages.push(m);
        existing.channels.add(m.channel);
        if (m.isUnread) existing.unreadCount += 1;
        if (m.needsReply) existing.needsReplyCount += 1;
        if (m.receivedAt > existing.latest.receivedAt) {
          existing.latest = m;
        }
        const t = triageMap.get(m.id);
        if (t) {
          if (
            !existing.topUrgency ||
            (t.urgency === "high" && existing.topUrgency !== "high") ||
            (t.urgency === "medium" && existing.topUrgency === "low")
          ) {
            existing.topUrgency = t.urgency;
          }
        }
      } else {
        const t = triageMap.get(m.id);
        groups.set(key, {
          key,
          name: m.fromName,
          handle: m.fromHandle,
          channels: new Set([m.channel]),
          messages: [m],
          latest: m,
          unreadCount: m.isUnread ? 1 : 0,
          needsReplyCount: m.needsReply ? 1 : 0,
          topUrgency: t?.urgency ?? null,
          hoursSinceLast: 0,
          relationship: "warm",
        });
      }
    }

    // Finalize hours + relationship
    const out: PersonGroup[] = [];
    for (const g of groups.values()) {
      g.hoursSinceLast = Math.round((now - g.latest.receivedAt.getTime()) / HOUR_MS);
      g.relationship = inferRelationship(g.messages, g.hoursSinceLast, g.needsReplyCount);
      // Sort messages newest-first within the group
      g.messages.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
      out.push(g);
    }

    // Default ordering: needs-reply first, then by recency, broadcasts last.
    out.sort((a, b) => {
      const aBroadcast = a.relationship === "broadcast" ? 1 : 0;
      const bBroadcast = b.relationship === "broadcast" ? 1 : 0;
      if (aBroadcast !== bBroadcast) return aBroadcast - bBroadcast;
      if (a.needsReplyCount !== b.needsReplyCount) {
        return b.needsReplyCount - a.needsReplyCount;
      }
      return b.latest.receivedAt.getTime() - a.latest.receivedAt.getTime();
    });

    return out;
    // DAY_MS reserved for future extensions (stale buckets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, triageMap]);
}

export const _DAY_MS = DAY_MS;
