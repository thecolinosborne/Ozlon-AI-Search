// TEMPORARY: simulated render pipeline. Replace with real Remotion Lambda/Cloud worker in Phase 2.
// Progress: backend persists only queued/rendering/completed/failed. Frontend simulates intermediate % locally.

import { corsHeaders } from "@supabase/supabase-js/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface EditPlanAction {
  id: string;
  action_type: string;
  label: string;
  detail: string;
  phase: "pre" | "main" | "post";
  status: "pending" | "done" | "skipped";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, video_task_id } = await req.json();

    if (!video_task_id) {
      return new Response(JSON.stringify({ error: "video_task_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch task
    const { data: task, error: fetchErr } = await supabase
      .from("video_tasks")
      .select("*")
      .eq("id", video_task_id)
      .single();

    if (fetchErr || !task) {
      return new Response(JSON.stringify({ error: "Video task not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── generate_plan ──
    if (action === "generate_plan") {
      const prompt = `You are a video editing assistant. Given the following video task parameters, generate a structured edit plan as a JSON array of actions.

Source type: ${task.source_type}
Source content: ${task.source_content || "N/A"}
Edit instructions: ${task.edit_instructions || "Standard edit"}
Requested output: ${task.requested_output}
Aspect ratio: ${task.aspect_ratio}
Target duration: ${task.target_duration || "Auto"}

Return ONLY a JSON array of objects with these fields:
- id: a unique UUID string
- action_type: short identifier (e.g. "trim", "caption", "music", "color_grade", "transition", "export")
- label: human-readable short label
- detail: one-sentence description of what this step does
- phase: one of "pre", "main", or "post"
- status: always "pending"

Generate 4-7 actions that make sense for this video task. Return raw JSON array only, no markdown.`;

      const aiResponse = await fetch("https://ai.lovable.dev/api/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI Gateway error:", errText);
        return new Response(JSON.stringify({ error: "AI generation failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || "[]";

      let plan: EditPlanAction[];
      try {
        // Strip markdown fences if present
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        plan = JSON.parse(cleaned);
      } catch {
        console.error("Failed to parse AI plan:", content);
        return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Write back to DB
      const { error: updateErr } = await supabase
        .from("video_tasks")
        .update({ edit_plan: plan, edit_plan_status: "generated" })
        .eq("id", video_task_id);

      if (updateErr) {
        console.error("DB update error:", updateErr);
        return new Response(JSON.stringify({ error: "Failed to save edit plan" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ plan, edit_plan_status: "generated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── start_render ──
    if (action === "start_render") {
      // Guards
      if (task.edit_plan_status !== "approved") {
        return new Response(JSON.stringify({ error: "Edit plan must be approved before rendering" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const editPlan = task.edit_plan as unknown[];
      if (!Array.isArray(editPlan) || editPlan.length === 0) {
        return new Response(JSON.stringify({ error: "Edit plan is empty" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Double-start protection
      if (["queued", "rendering", "completed"].includes(task.render_status)) {
        return new Response(JSON.stringify({ error: `Cannot start render: status is already '${task.render_status}'` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Transition to rendering
      const { error: updateErr } = await supabase
        .from("video_tasks")
        .update({ render_status: "rendering", render_progress: 0 })
        .eq("id", video_task_id);

      if (updateErr) {
        // Attempt to set failed + append error history
        const errorEntry = {
          id: crypto.randomUUID(),
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          status: "failed",
          output_url: null,
          error: updateErr.message,
        };
        await supabase
          .from("video_tasks")
          .update({
            render_status: "failed",
            render_history: [...(task.render_history as unknown[] || []), errorEntry],
          })
          .eq("id", video_task_id);

        return new Response(JSON.stringify({ error: "Failed to start render" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ render_status: "rendering", started_at: new Date().toISOString() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── complete_render ──
    if (action === "complete_render") {
      // Guard: must be currently rendering
      if (task.render_status !== "rendering") {
        return new Response(JSON.stringify({ error: `Cannot complete: status is '${task.render_status}', expected 'rendering'` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const now = new Date().toISOString();
      const outputUrl = `https://mock-renders.lovable.app/${video_task_id}.mp4`;

      const successEntry = {
        id: crypto.randomUUID(),
        started_at: task.updated_at, // approximate start time
        completed_at: now,
        status: "completed",
        output_url: outputUrl,
        error: null,
      };

      const { error: updateErr } = await supabase
        .from("video_tasks")
        .update({
          render_status: "completed",
          render_progress: 100,
          output_url: outputUrl,
          render_history: [...(task.render_history as unknown[] || []), successEntry],
        })
        .eq("id", video_task_id);

      if (updateErr) {
        // Attempt to mark as failed
        const errorEntry = {
          id: crypto.randomUUID(),
          started_at: task.updated_at,
          completed_at: now,
          status: "failed",
          output_url: null,
          error: updateErr.message,
        };
        await supabase
          .from("video_tasks")
          .update({
            render_status: "failed",
            render_history: [...(task.render_history as unknown[] || []), errorEntry],
          })
          .eq("id", video_task_id);

        return new Response(JSON.stringify({ error: "Failed to complete render" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ render_status: "completed", output_url: outputUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("render-video error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
