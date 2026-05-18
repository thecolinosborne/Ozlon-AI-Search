// Viral Creative manifest — AI pipeline for marketing angles, hooks,
// visual prompts, and cross-platform repurposing. Pairs with
// analyze_youtube_channel and the Higgsfield image/video generators.
//
// Receiver: supabase/functions/viral-creative/index.ts
// Envelope: flat — { action, ...params }
// Auth: LOVABLE_API_KEY (server-side). No per-user keys required.

import type { IntegrationManifest } from "./types.ts";

export const viralCreativeIntegration: IntegrationManifest = {
  id: "viral-creative",
  displayName: "Viral Creative",
  edgeFunction: "viral-creative",
  envelope: "flat",
  tools: [
    {
      name: "viral_analyze_reference",
      description:
        "Break down a competitor or reference piece of content (ad copy, script, post, hook, video transcript) and surface the patterns that make it work: hook type, angle, emotional beats, visual style, structural template. Use when the user shares a URL, paste, or asks 'why does this work?'.",
      action: "analyze_reference",
      schema: {
        type: "object",
        properties: {
          reference_text: {
            type: "string",
            description: "Raw text/transcript/copy of the reference content. If user gave a URL, fetch the page first and pass the text here.",
          },
        },
        required: ["reference_text"],
      },
      mapArgs: (a) => ({ reference_text: a.reference_text }),
      sideEffect: "read",
      cost: "moderate",
    },
    {
      name: "viral_extract_hooks",
      description:
        "Generate 8–12 scroll-stopping hook variants given a set of marketing angles and a campaign brief. Each hook returns text, type, visual concept, and why-it-works rationale.",
      action: "extract_hooks",
      schema: {
        type: "object",
        properties: {
          request_text: { type: "string", description: "Campaign brief / what we're selling." },
          angles: {
            type: "array",
            description: "Array of angle objects from viral_analyze_angles (or your own).",
            items: { type: "object" },
          },
          platform: {
            type: "string",
            description: "tiktok | reels | shorts | youtube | meta | x | linkedin | general",
          },
        },
        required: ["request_text", "angles"],
      },
      mapArgs: (a) => ({
        request_text: a.request_text,
        angles: a.angles,
        platform: a.platform,
      }),
      sideEffect: "read",
      cost: "moderate",
    },
    {
      name: "viral_analyze_angles",
      description:
        "Generate 6–10 distinct marketing angles for a campaign (problem/solution, transformation, authority, status, urgency, etc.) with why-it-works and example headlines.",
      action: "analyze_angles",
      schema: {
        type: "object",
        properties: {
          request_text: { type: "string", description: "Campaign goal / offer." },
          source_context: {
            type: "object",
            description: "Optional product, audience, voice, prior wins, brand do/don'ts.",
          },
          platform: { type: "string" },
          content_goal: {
            type: "string",
            description: "conversion | awareness | retention | engagement",
          },
        },
        required: ["request_text"],
      },
      mapArgs: (a) => ({
        request_text: a.request_text,
        source_context: a.source_context,
        platform: a.platform,
        content_goal: a.content_goal,
      }),
      sideEffect: "read",
      cost: "moderate",
    },
    {
      name: "viral_repurpose",
      description:
        "Take a single concept (or winning post) and rewrite/restage it for additional platforms — preserving the spine but adapting hook, pacing, format, and CTA to each surface.",
      action: "repurpose",
      schema: {
        type: "object",
        properties: {
          concept: {
            type: "object",
            description: "The source concept (text, hook, scene description, or a viral-creative prompt object).",
          },
          platform: { type: "string", description: "Original platform the concept came from." },
        },
        required: ["concept"],
      },
      mapArgs: (a) => ({ concept: a.concept, platform: a.platform }),
      sideEffect: "read",
      cost: "moderate",
    },
    {
      name: "viral_full_pipeline",
      description:
        "End-to-end creative pipeline: angles → hooks → (optional reference analysis) → visual prompts → scoring → output package. Use when the user asks for 'a full campaign', 'a creative pack', or 'give me everything to launch this'. Heavier than the individual tools — only call when a complete deliverable is requested.",
      action: "full_pipeline",
      schema: {
        type: "object",
        properties: {
          request_text: { type: "string", description: "What we're selling / campaign goal." },
          source_context: {
            type: "object",
            description: "Product, audience, brand voice, prior winners.",
          },
          platform: { type: "string" },
          content_goal: { type: "string" },
          reference_text: {
            type: "string",
            description: "Optional reference content to learn patterns from.",
          },
        },
        required: ["request_text"],
      },
      mapArgs: (a) => ({
        request_text: a.request_text,
        source_context: a.source_context,
        platform: a.platform,
        content_goal: a.content_goal,
        reference_text: a.reference_text,
      }),
      sideEffect: "read",
      cost: "expensive",
    },
  ],
};
