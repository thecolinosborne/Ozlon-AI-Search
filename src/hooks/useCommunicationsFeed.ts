import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type CommChannel = "email" | "slack" | "sms" | "voicemail";

export interface CommMessage {
  id: string;
  channel: CommChannel;
  source: "gmail" | "slack" | "ghl";
  fromName: string;
  fromHandle?: string;
  channelLabel: string;
  subject?: string;
  preview: string;
  receivedAt: Date;
  isUnread: boolean;
  needsReply: boolean;
  threadId?: string;
  audioUrl?: string;
  durationSec?: number;
  groupCount?: number;
}

export type TriageUrgency = "high" | "medium" | "low";
export type TriageAction = "reply" | "schedule" | "snooze" | "done" | "ignore";

export interface TriageItem {
  messageId: string;
  urgency: TriageUrgency;
  reason: string;
  actionHint: TriageAction;
  suggestedReply?: string;
}

export interface PriorityItem {
  id: string;
  channel: CommChannel;
  who: string;
  what: string;
  channelLabel: string;
  // Enriched by triage (optional — present when AI triage succeeds and matched).
  urgency?: TriageUrgency;
  reason?: string;
  actionHint?: TriageAction;
  suggestedReply?: string;
}

export interface DailyDigest {
  heroLine: string;
  subLine: string;
  priorities: PriorityItem[];
  briefScript: string;
  briefDurationSec: number;
}

export interface FeedDiagnostics {
  partial: boolean;
  slackReason: string | null;
  slackScope: string | null;
  sources: { email: number; slack: number; sms: number; voicemail: number };
}

export interface CommunicationsFeed {
  digest: DailyDigest;
  stream: CommMessage[];
  diagnostics: FeedDiagnostics;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
}

const FALLBACK_DIGEST: DailyDigest = {
  heroLine: "Loading your day…",
  subLine: "",
  priorities: [],
  briefScript: "",
  briefDurationSec: 0,
};

const FALLBACK_DIAGNOSTICS: FeedDiagnostics = {
  partial: false,
  slackReason: null,
  slackScope: null,
  sources: { email: 0, slack: 0, sms: 0, voicemail: 0 },
};

interface AggregateData {
  stream: Array<Omit<CommMessage, "receivedAt"> & { receivedAt: string }>;
  priorities: PriorityItem[];
  sourceCounts?: FeedDiagnostics["sources"];
}

interface AggregateEnvelope {
  ok?: boolean;
  data?: AggregateData;
  diagnostics?: {
    partial?: boolean;
    slackReason?: string | null;
    slackScope?: string | null;
    sources?: FeedDiagnostics["sources"];
  };
  stream?: AggregateData["stream"];
  priorities?: PriorityItem[];
  sourceCounts?: FeedDiagnostics["sources"];
  partial?: { slack?: boolean; slackReason?: string | null; slackScope?: string | null };
}

interface DigestEnvelope {
  ok?: boolean;
  data?: DailyDigest & { generatedAt?: string };
  heroLine?: string;
  subLine?: string;
  priorities?: PriorityItem[];
  briefScript?: string;
  briefDurationSec?: number;
}

function unwrapAggregate(raw: AggregateEnvelope): {
  data: AggregateData;
  diagnostics: FeedDiagnostics;
} {
  const data: AggregateData = raw.data ?? {
    stream: raw.stream ?? [],
    priorities: raw.priorities ?? [],
    sourceCounts: raw.sourceCounts,
  };
  const diag = raw.diagnostics ?? {
    partial: raw.partial?.slack ?? false,
    slackReason: raw.partial?.slackReason ?? null,
    slackScope: raw.partial?.slackScope ?? null,
    sources: raw.sourceCounts,
  };
  return {
    data,
    diagnostics: {
      partial: diag.partial ?? false,
      slackReason: diag.slackReason ?? null,
      slackScope: diag.slackScope ?? null,
      sources: diag.sources ?? data.sourceCounts ?? FALLBACK_DIAGNOSTICS.sources,
    },
  };
}
function unwrapDigest(raw: DigestEnvelope): DailyDigest | null {
  const d = raw.data ?? (raw.heroLine
    ? {
        heroLine: raw.heroLine,
        subLine: raw.subLine ?? "",
        priorities: raw.priorities ?? [],
        briefScript: raw.briefScript ?? "",
        briefDurationSec: raw.briefDurationSec ?? 0,
      }
    : null);
  if (!d) return null;
  return {
    heroLine: d.heroLine,
    subLine: d.subLine,
    priorities: d.priorities,
    briefScript: d.briefScript,
    briefDurationSec: d.briefDurationSec,
  };
}

interface CachedRow {
  source: string;
  channel: string;
  external_id: string;
  thread_external_id: string | null;
  from_name: string | null;
  from_handle: string | null;
  channel_label: string | null;
  subject: string | null;
  preview: string | null;
  received_at: string;
  is_unread: boolean;
  needs_reply: boolean;
  audio_url: string | null;
  duration_sec: number | null;
}

interface ReadStateRow {
  message_key: string;
  read_at: string | null;
  snoozed_until: string | null;
  archived_at: string | null;
  deleted_at: string | null;
}

function rowToMessage(r: CachedRow, hidden: boolean): CommMessage | null {
  if (hidden) return null;
  return {
    id: `${r.source}:${r.external_id}`,
    channel: r.channel as CommChannel,
    source: r.source as CommMessage["source"],
    fromName: r.from_name ?? "Unknown",
    fromHandle: r.from_handle ?? undefined,
    channelLabel: r.channel_label ?? r.channel,
    subject: r.subject ?? undefined,
    preview: r.preview ?? "",
    receivedAt: new Date(r.received_at),
    isUnread: r.is_unread,
    needsReply: r.needs_reply,
    threadId: r.thread_external_id ?? undefined,
    audioUrl: r.audio_url ?? undefined,
    durationSec: r.duration_sec ?? undefined,
  };
}

export function useCommunicationsFeed(): CommunicationsFeed {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  // Aggregate query — drives fresh fetches + writes to cache server-side.
  const aggregateQ = useQuery({
    queryKey: ["communications", "aggregate"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("communications-aggregate", {
        body: {},
      });
      if (error) throw error;
      return unwrapAggregate(data as AggregateEnvelope);
    },
    staleTime: 60_000,
  });

  // Cached stream — instant render from DB; updated via realtime.
  const cachedQ = useQuery({
    queryKey: ["communications", "cached", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [msgsRes, stateRes] = await Promise.all([
        supabase
          .from("communications_messages")
          .select(
            "source,channel,external_id,thread_external_id,from_name,from_handle,channel_label,subject,preview,received_at,is_unread,needs_reply,audio_url,duration_sec",
          )
          .order("received_at", { ascending: false })
          .limit(200),
        supabase
          .from("communications_read_state")
          .select("message_key,read_at,snoozed_until,archived_at,deleted_at"),
      ]);
      const rows = (msgsRes.data ?? []) as CachedRow[];
      const states = (stateRes.data ?? []) as ReadStateRow[];
      const stateMap = new Map<string, ReadStateRow>();
      for (const s of states) stateMap.set(s.message_key, s);
      const now = Date.now();
      const out: CommMessage[] = [];
      for (const r of rows) {
        const key = `${r.source}:${r.external_id}`;
        const state = stateMap.get(key);
        const hidden =
          !!state &&
          ((state.deleted_at !== null) ||
            (state.archived_at !== null) ||
            (state.snoozed_until !== null && new Date(state.snoozed_until).getTime() > now));
        const msg = rowToMessage(r, hidden);
        if (!msg) continue;
        // Apply read overlay
        if (state?.read_at) {
          msg.isUnread = false;
          msg.needsReply = false;
        }
        out.push(msg);
      }
      return out;
    },
    staleTime: 30_000,
  });

  // Realtime subscription — invalidate cached stream on any change.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`comm-msgs-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "communications_messages",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["communications", "cached", userId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "communications_read_state",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["communications", "cached", userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const digestQ = useQuery({
    queryKey: ["communications", "digest"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("communications-digest", {
        body: {},
      });
      if (error) throw error;
      return unwrapDigest(data as DigestEnvelope);
    },
    staleTime: 5 * 60_000,
  });

  // Build a hash of the top-20 cached message IDs so triage only re-runs when
  // there's actually new mail (cuts AI cost ~80%).
  const triageCacheKey = (cachedQ.data ?? [])
    .slice(0, 20)
    .map((m) => m.id)
    .join("|");

  // Triage — AI-enriched per-message judgments (urgency, action hint, suggested reply).
  const triageQ = useQuery({
    queryKey: ["communications", "triage", triageCacheKey],
    enabled: triageCacheKey.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("communications-triage", {
        body: {},
      });
      if (error) throw error;
      const items = ((data as { data?: { items?: TriageItem[] } })?.data?.items ?? []) as TriageItem[];
      const map = new Map<string, TriageItem>();
      for (const it of items) map.set(it.messageId, it);
      return map;
    },
    staleTime: 5 * 60_000,
  });

  // Prefer cached stream when available; fall back to live aggregate response.
  const liveStream: CommMessage[] = (aggregateQ.data?.data.stream ?? [])
    .map((m) => ({ ...m, receivedAt: new Date(m.receivedAt) }))
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());

  const stream = (cachedQ.data && cachedQ.data.length > 0) ? cachedQ.data : liveStream;

  const basePriorities: PriorityItem[] =
    digestQ.data?.priorities ?? aggregateQ.data?.data.priorities ?? [];

  // Enrich priorities with triage hints when available.
  // Priority `id` from aggregator is `p1`, `p2`, etc — we re-match by index against
  // the top-N stream candidates that also match the priority's `who` field, and we
  // also try direct id lookup in case the digest includes message ids.
  const triageMap = triageQ.data;
  const priorities: PriorityItem[] = basePriorities.map((p) => {
    if (!triageMap || triageMap.size === 0) return p;
    // Direct id hit (forward-compatible if digest starts emitting messageId).
    const direct = triageMap.get(p.id);
    if (direct) {
      return { ...p, urgency: direct.urgency, reason: direct.reason, actionHint: direct.actionHint, suggestedReply: direct.suggestedReply };
    }
    // Heuristic: find a stream message whose fromName starts with `who`.
    const candidate = stream.find(
      (m) => m.fromName.toLowerCase().startsWith(p.who.toLowerCase().slice(0, 8)),
    );
    if (candidate) {
      const t = triageMap.get(candidate.id);
      if (t) {
        return {
          ...p,
          id: candidate.id, // promote to real message id so action chips can act on it
          urgency: t.urgency,
          reason: t.reason,
          actionHint: t.actionHint,
          suggestedReply: t.suggestedReply,
        };
      }
    }
    return p;
  });

  const digest: DailyDigest =
    digestQ.data
      ? { ...digestQ.data, priorities }
      : {
          ...FALLBACK_DIGEST,
          priorities,
        };

  const diagnostics: FeedDiagnostics = aggregateQ.data?.diagnostics ?? FALLBACK_DIAGNOSTICS;

  return {
    digest,
    stream,
    diagnostics,
    isLoading: (aggregateQ.isLoading && !cachedQ.data) || digestQ.isLoading,
    isFetching: aggregateQ.isFetching || digestQ.isFetching || cachedQ.isFetching || triageQ.isFetching,
    refetch: () => {
      aggregateQ.refetch();
      digestQ.refetch();
      cachedQ.refetch();
      triageQ.refetch();
    },
  };
}
