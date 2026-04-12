import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DESCRIPT_BASE = "https://descriptapi.com/v1";

function generateDescriptPrompt(userIntent: string): string {
  const intent = userIntent.toLowerCase().trim();

  if (intent.includes("make this better") || intent.includes("improve") || intent.includes("enhance everything")) {
    return "remove filler words, improve audio quality, add captions, create highlight clips";
  }
  if (intent.includes("tiktok") || intent.includes("reels") || intent.includes("shorts") || intent.includes("social media clips")) {
    return "create 3 short engaging clips optimized for social media, each under 60 seconds with captions";
  }
  if (intent.includes("clean audio") || intent.includes("fix audio") || intent.includes("audio quality")) {
    return "enhance audio quality and remove background noise";
  }
  if (intent.includes("filler") || intent.includes("um") || intent.includes("uh")) {
    return "remove all filler words including um, uh, like, you know";
  }
  if (intent.includes("caption") || intent.includes("subtitle")) {
    return "add accurate captions and subtitles to the entire video";
  }
  if (intent.includes("highlight") || intent.includes("best parts") || intent.includes("key moments")) {
    return "identify and extract the most engaging highlight moments into clips";
  }
  if (intent.includes("rough cut") || intent.includes("first cut")) {
    return "create a rough cut by removing dead air, long pauses, and false starts";
  }
  if (intent.includes("transcript") || intent.includes("transcribe")) {
    return "generate a full transcript of the media";
  }
  if (intent.includes("repurpose") || intent.includes("content pieces")) {
    return "repurpose this content into multiple formats: highlight clips, quote cards, and a summary";
  }
  if (intent.includes("podcast") && (intent.includes("better") || intent.includes("edit"))) {
    return "remove filler words, improve audio quality, add captions, create highlight clips for podcast distribution";
  }

  return userIntent;
}

async function descriptFetch(path: string, apiKey: string, options: RequestInit = {}) {
  const url = `${DESCRIPT_BASE}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(`Descript API error [${resp.status}]: ${JSON.stringify(data)}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const DESCRIPT_API_KEY = Deno.env.get("DESCRIPT_API_KEY");
    if (!DESCRIPT_API_KEY) {
      return new Response(JSON.stringify({ error: "DESCRIPT_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action, ...params } = body;

    switch (action) {
      // ─── TEST CONNECTION ─────────────────────────────────
      case "test_connection": {
        const data = await descriptFetch("/jobs", DESCRIPT_API_KEY);
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ─── IMPORT MEDIA ────────────────────────────────────
      case "import_media": {
        const { media_url, project_id: existingProjectId } = params;
        if (!media_url) {
          return new Response(JSON.stringify({ error: "media_url is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const payload: Record<string, unknown> = { input: { url: media_url } };
        if (existingProjectId) payload.project_id = existingProjectId;

        const data = await descriptFetch("/jobs/import/project_media", DESCRIPT_API_KEY, {
          method: "POST",
          body: JSON.stringify(payload),
        });

        const jobId = data.id || data.job_id || data.data?.id || "unknown";
        const projectId = data.project_id || existingProjectId || "unknown";

        await supabase.from("descript_jobs").insert({
          project_id: projectId,
          job_id: jobId,
          job_type: "import",
          status: data.state || data.status || "pending",
          output_data: data,
        });

        return new Response(JSON.stringify({ success: true, job_id: jobId, project_id: projectId, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ─── RUN AGENT EDIT ──────────────────────────────────
      case "run_agent_edit": {
        const { project_id, user_intent } = params;
        if (!project_id) {
          return new Response(JSON.stringify({ error: "project_id is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!user_intent) {
          return new Response(JSON.stringify({ error: "user_intent is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const prompt = generateDescriptPrompt(user_intent);

        const data = await descriptFetch("/jobs/agent", DESCRIPT_API_KEY, {
          method: "POST",
          body: JSON.stringify({ project_id, prompt }),
        });

        const jobId = data.id || data.job_id || data.data?.id || "unknown";

        await supabase.from("descript_jobs").insert({
          project_id,
          job_id: jobId,
          job_type: "agent",
          status: data.state || data.status || "pending",
          input_prompt: prompt,
          output_data: data,
        });

        return new Response(
          JSON.stringify({ success: true, job_id: jobId, prompt_used: prompt, data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ─── GET JOB STATUS ──────────────────────────────────
      case "get_job_status": {
        const { job_id } = params;
        if (!job_id) {
          return new Response(JSON.stringify({ error: "job_id is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const data = await descriptFetch(`/jobs/${job_id}`, DESCRIPT_API_KEY);

        await supabase
          .from("descript_jobs")
          .update({
            status: data.state || data.status || "unknown",
            output_data: data,
          })
          .eq("job_id", job_id);

        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ─── LIST JOBS ───────────────────────────────────────
      case "list_jobs": {
        const data = await descriptFetch("/jobs", DESCRIPT_API_KEY);
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ─── CANCEL JOB ──────────────────────────────────────
      case "cancel_job": {
        const { job_id } = params;
        if (!job_id) {
          return new Response(JSON.stringify({ error: "job_id is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const data = await descriptFetch(`/jobs/${job_id}`, DESCRIPT_API_KEY, {
          method: "DELETE",
        });

        await supabase
          .from("descript_jobs")
          .update({ status: "cancelled" })
          .eq("job_id", job_id);

        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ─── EDIT IN DESCRIPT (HANDOFF) ──────────────────────
      case "edit_in_descript": {
        const { schema } = params;
        if (!schema) {
          return new Response(JSON.stringify({ error: "schema is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const data = await descriptFetch("/edit_in_descript/schema", DESCRIPT_API_KEY, {
          method: "POST",
          body: JSON.stringify(schema),
        });

        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ─── GET PUBLISHED PROJECT ───────────────────────────
      case "get_published_project": {
        const { slug } = params;
        if (!slug) {
          return new Response(JSON.stringify({ error: "slug is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const data = await descriptFetch(`/published_projects/${slug}`, DESCRIPT_API_KEY);

        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    console.error("Descript function error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
