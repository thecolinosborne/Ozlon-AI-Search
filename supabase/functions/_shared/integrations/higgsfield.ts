// Higgsfield AI integration manifest — exposes the existing `higgsfield`
// edge function (generate_image / generate_video / status / cancel) as
// first-class chat tools the AI can call.

import type { IntegrationManifest } from "./types.ts";
import { formatRecord } from "./_formatters.ts";

export const higgsfieldIntegration: IntegrationManifest = {
  id: "higgsfield",
  displayName: "Higgsfield AI",
  edgeFunction: "higgsfield",
  envelope: "nested",
  tools: [
    {
      name: "higgsfield_generate_image",
      description:
        "Generate an image with Higgsfield SOUL (text-to-image). Use for hero stills, ads, photodumps, brand visuals. Returns a request_id you must poll with higgsfield_job_status. The prompt should follow Higgsfield SOUL conventions: subject + setting + lighting + lens/composition + mood + (optional HEX palette like '#1A1A1A, #FF6B35'). Default model 'higgsfield-ai/soul/standard'.",
      action: "generate_image",
      sideEffect: "external_call",
      cost: "moderate",
      schema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "SOUL-style prompt: subject, setting, lighting, lens, mood, optional HEX colors." },
          aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1", "4:3", "3:4"], description: "Default 16:9." },
          resolution: { type: "string", enum: ["720p", "1080p"], description: "Default 720p." },
          model: { type: "string", description: "Override model id, default higgsfield-ai/soul/standard." },
        },
        required: ["prompt"],
      },
      mapArgs: (a) => ({ prompt: a.prompt, aspect_ratio: a.aspect_ratio, resolution: a.resolution, model: a.model }),
      formatter: (data) => formatRecord(data, { "Request ID": "id", Status: "status" }, { label: "Higgsfield image job" }),
    },
    {
      name: "higgsfield_generate_video",
      description:
        "Generate a video with Higgsfield DoP (image-to-video). Requires an image_url (a previously generated SOUL image works well). Prompt should describe MOTION only — camera move, subject action, timing. Returns a request_id you must poll. Default model 'higgsfield-ai/dop/standard'.",
      action: "generate_video",
      sideEffect: "external_call",
      cost: "expensive",
      schema: {
        type: "object",
        properties: {
          image_url: { type: "string", description: "Source image URL (the still that DoP animates)." },
          prompt: { type: "string", description: "MOTION-only prompt: camera move (push in, orbit, dolly, crane), subject action, timing." },
          duration: { type: "number", description: "Seconds, default 5." },
          model: { type: "string", description: "Override model id, default higgsfield-ai/dop/standard." },
        },
        required: ["image_url"],
      },
      mapArgs: (a) => ({ image_url: a.image_url, prompt: a.prompt, duration: a.duration, model: a.model }),
      formatter: (data) => formatRecord(data, { "Request ID": "id", Status: "status" }, { label: "Higgsfield video job" }),
    },
    {
      name: "higgsfield_job_status",
      description:
        "Check the status of a Higgsfield image or video generation job by request_id. Returns status (queued | in_progress | completed | failed) and, when completed, the output asset URL(s). Poll every 3-5 seconds, max ~2 minutes for images, ~5 minutes for video.",
      action: "get_job_status",
      sideEffect: "read",
      cost: "cheap",
      schema: {
        type: "object",
        properties: { request_id: { type: "string" } },
        required: ["request_id"],
      },
      mapArgs: (a) => ({ request_id: a.request_id }),
      formatter: (data) => formatRecord(data, { Status: "status", Output: "result" }, { label: "Higgsfield job" }),
    },
    {
      name: "higgsfield_cancel_job",
      description: "Cancel an in-progress Higgsfield job by request_id.",
      action: "cancel_job",
      sideEffect: "destructive",
      cost: "cheap",
      requiresConfirmation: true,
      schema: {
        type: "object",
        properties: { request_id: { type: "string" } },
        required: ["request_id"],
      },
      mapArgs: (a) => ({ request_id: a.request_id }),
      formatter: (data) => `Cancellation: ${JSON.stringify(data)}`,
    },
  ],
};
