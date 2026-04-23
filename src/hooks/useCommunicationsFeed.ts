import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export interface PriorityItem {
  id: string;
  channel: CommChannel;
  who: string;
  what: string;
  channelLabel: string;
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
  diagnostics?: { partial?: boolean; slackReason?: string | null; sources?: FeedDiagnostics["sources"] };
  // legacy mirrors
  stream?: AggregateData["stream"];
  priorities?: PriorityItem[];
  sourceCounts?: FeedDiagnostics["sources"];
  partial?: { slack?: boolean; slackReason?: string | null };
}

interface DigestEnvelope {
  ok?: boolean;
  data?: DailyDigest & { generatedAt?: string };
  // legacy mirrors
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
    sources: raw.sourceCounts,
  };
  return {
    data,
    diagnostics: {
      partial: diag.partial ?? false,
      slackReason: diag.slackReason ?? null,
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

export function useCommunicationsFeed(): CommunicationsFeed {
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

  const stream: CommMessage[] = (aggregateQ.data?.data.stream ?? [])
    .map((m) => ({ ...m, receivedAt: new Date(m.receivedAt) }))
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());

  const digest: DailyDigest =
    digestQ.data ?? {
      ...FALLBACK_DIGEST,
      priorities: aggregateQ.data?.data.priorities ?? [],
    };

  const diagnostics: FeedDiagnostics = aggregateQ.data?.diagnostics ?? FALLBACK_DIAGNOSTICS;

  return {
    digest,
    stream,
    diagnostics,
    isLoading: aggregateQ.isLoading || digestQ.isLoading,
    isFetching: aggregateQ.isFetching || digestQ.isFetching,
    refetch: () => {
      aggregateQ.refetch();
      digestQ.refetch();
    },
  };
}
