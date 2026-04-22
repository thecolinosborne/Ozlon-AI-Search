import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      heroLine: "3 things need you today.",
      subLine: "12 messages across 4 channels since yesterday.",
      priorities: [
        { id: "p1", channel: "email", who: "Sarah", what: "contract reply", channelLabel: "Gmail" },
        { id: "p2", channel: "sms", who: "New lead", what: "pricing question", channelLabel: "SMS" },
        { id: "p3", channel: "slack", who: "@mention", what: "in #launch", channelLabel: "Slack" },
      ],
      briefScript:
        "Three things, friend. Sarah needs the contract back today. A new lead asked about pricing — sounds warm. And you were mentioned in launch about the Friday demo. Want me to draft replies?",
      briefDurationSec: 45,
      generatedAt: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
