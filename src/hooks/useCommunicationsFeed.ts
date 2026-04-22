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

export interface CommunicationsFeed {
  digest: DailyDigest;
  stream: CommMessage[];
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

interface AggregateResponse {
  stream: Array<Omit<CommMessage, "receivedAt"> & { receivedAt: string }>;
  priorities: PriorityItem[];
}

interface DigestResponse {
  heroLine: string;
  subLine: string;
  priorities: PriorityItem[];
  briefScript: string;
  briefDurationSec: number;
}

export function useCommunicationsFeed(): CommunicationsFeed {
  const aggregateQ = useQuery({
    queryKey: ["communications", "aggregate"],
    queryFn: async (): Promise<AggregateResponse> => {
      const { data, error } = await supabase.functions.invoke("communications-aggregate", {
        body: {},
      });
      if (error) throw error;
      return data as AggregateResponse;
    },
    staleTime: 60_000,
  });

  const digestQ = useQuery({
    queryKey: ["communications", "digest"],
    queryFn: async (): Promise<DigestResponse> => {
      const { data, error } = await supabase.functions.invoke("communications-digest", {
        body: {},
      });
      if (error) throw error;
      return data as DigestResponse;
    },
    staleTime: 5 * 60_000,
  });

  const stream: CommMessage[] = (aggregateQ.data?.stream ?? [])
    .map((m) => ({ ...m, receivedAt: new Date(m.receivedAt) }))
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());

  const digest: DailyDigest = digestQ.data ?? {
    ...FALLBACK_DIGEST,
    priorities: aggregateQ.data?.priorities ?? [],
  };

  return {
    digest,
    stream,
    isLoading: aggregateQ.isLoading || digestQ.isLoading,
    isFetching: aggregateQ.isFetching || digestQ.isFetching,
    refetch: () => {
      aggregateQ.refetch();
      digestQ.refetch();
    },
  };
}
