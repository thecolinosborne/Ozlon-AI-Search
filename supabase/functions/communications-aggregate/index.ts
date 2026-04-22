import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface PriorityItem {
  id: string;
  channel: "email" | "slack" | "sms" | "voicemail";
  who: string;
  what: string;
  channelLabel: string;
}

interface CommMessage {
  id: string;
  channel: "email" | "slack" | "sms" | "voicemail";
  source: "gmail" | "slack" | "ghl";
  fromName: string;
  fromHandle?: string;
  channelLabel: string;
  subject?: string;
  preview: string;
  receivedAt: string;
  isUnread: boolean;
  needsReply: boolean;
  threadId?: string;
  audioUrl?: string;
  durationSec?: number;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const STREAM: CommMessage[] = [
  {
    id: "m1",
    channel: "email",
    source: "gmail",
    fromName: "Sarah Chen",
    channelLabel: "Gmail",
    subject: "Re: Contract revisions",
    preview: "Looks great, just two changes — can we hop on a call Friday to finalize?",
    receivedAt: hoursAgo(2),
    isUnread: true,
    needsReply: true,
  },
  {
    id: "m2",
    channel: "slack",
    source: "slack",
    fromName: "#launch",
    channelLabel: "Slack",
    preview: "@you can you review the deck before the demo tomorrow?",
    receivedAt: hoursAgo(3),
    isUnread: true,
    needsReply: true,
  },
  {
    id: "m3",
    channel: "sms",
    source: "ghl",
    fromName: "+1 (415) 555-0142",
    channelLabel: "SMS",
    preview: "Hey is this still available? Saw your post earlier today",
    receivedAt: hoursAgo(5),
    isUnread: true,
    needsReply: true,
  },
  {
    id: "m4",
    channel: "voicemail",
    source: "ghl",
    fromName: "Mike Reynolds",
    channelLabel: "Voicemail",
    preview: "Hey it's Mike from the Tuesday meeting, give me a ring back when you get a sec",
    receivedAt: hoursAgo(7),
    isUnread: true,
    needsReply: false,
    durationSec: 42,
  },
  {
    id: "m5",
    channel: "email",
    source: "gmail",
    fromName: "Stripe",
    channelLabel: "Gmail",
    subject: "Your receipt from Acme Co",
    preview: "Thanks for your payment of $249.00",
    receivedAt: hoursAgo(9),
    isUnread: false,
    needsReply: false,
  },
  {
    id: "m6",
    channel: "slack",
    source: "slack",
    fromName: "Dani Park",
    channelLabel: "Slack DM",
    preview: "Sent you the new Figma — let me know what you think",
    receivedAt: hoursAgo(11),
    isUnread: false,
    needsReply: false,
  },
  {
    id: "m7",
    channel: "email",
    source: "gmail",
    fromName: "Alex Rivera",
    channelLabel: "Gmail",
    subject: "Q3 numbers — quick sync?",
    preview: "Have 15 min tomorrow to walk through the deck before the board call?",
    receivedAt: daysAgo(1),
    isUnread: false,
    needsReply: true,
  },
  {
    id: "m8",
    channel: "sms",
    source: "ghl",
    fromName: "+1 (212) 555-0188",
    channelLabel: "SMS",
    preview: "Confirming our 3pm — see you then 👍",
    receivedAt: daysAgo(1),
    isUnread: false,
    needsReply: false,
  },
  {
    id: "m9",
    channel: "email",
    source: "gmail",
    fromName: "GitHub",
    channelLabel: "Gmail",
    subject: "[ozlon/orb] PR #142 ready for review",
    preview: "Jamie opened a pull request: Add communications hub scaffolding",
    receivedAt: daysAgo(2),
    isUnread: false,
    needsReply: false,
  },
  {
    id: "m10",
    channel: "voicemail",
    source: "ghl",
    fromName: "Unknown caller",
    channelLabel: "Voicemail",
    preview: "Hi this is Janet from Blue Lake calling about your inquiry...",
    receivedAt: daysAgo(2),
    isUnread: false,
    needsReply: false,
    durationSec: 27,
  },
];

const PRIORITIES: PriorityItem[] = [
  { id: "p1", channel: "email", who: "Sarah", what: "contract reply", channelLabel: "Gmail" },
  { id: "p2", channel: "sms", who: "New lead", what: "pricing question", channelLabel: "SMS" },
  { id: "p3", channel: "slack", who: "@mention", what: "in #launch", channelLabel: "Slack" },
];

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      stream: STREAM,
      priorities: PRIORITIES,
      sourceCounts: { email: 4, slack: 2, sms: 2, voicemail: 2 },
      lastRefreshed: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
