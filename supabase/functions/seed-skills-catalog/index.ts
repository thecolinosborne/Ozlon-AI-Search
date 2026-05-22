// One-shot seeder: upserts every skill JSON from public/sample-skills/ into the skills catalog.
// Reads files from the deployed app's public URL (so no FS access needed).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SKILL_FILES = [
  "ad-creative","ai-seo","analytics-tracking","brand-voice-guardian","cold-email",
  "competitor-watch","content-calendar","copywriting","customer-research","email-sequence",
  "higgsfield-dop-camera","higgsfield-hex-color","higgsfield-moodboard","higgsfield-multi-scene",
  "higgsfield-orchestrator","higgsfield-popcorn-consistency","higgsfield-seedance",
  "higgsfield-sora2-video","higgsfield-soul-image","landing-page-builder",
  "marketing-orchestrator","page-cro","pm-assign","pm-breakdown","pm-orchestrator",
  "pm-prioritize","pm-roadmap","product-marketing-context","seo-audit","social-post",
  "social-router","social-x","social-linkedin","social-instagram","social-facebook",
  "social-tiktok","social-youtube","social-threads","social-pinterest",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const base = url.searchParams.get("base") ?? "https://ozlon.ai";

  const results: { slug: string; ok: boolean; error?: string }[] = [];
  for (const slug of SKILL_FILES) {
    try {
      const r = await fetch(`${base}/sample-skills/${slug}.skill.json`);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const manifest = await r.json();
      const { error } = await supabase.from("skills").upsert(
        {
          slug: manifest.slug,
          name: manifest.name || manifest.slug,
          description: manifest.description || "",
          version: manifest.version || "1.0.0",
          manifest,
          source: "builtin",
          visibility: "public",
          trust_tier: 1,
        },
        { onConflict: "slug" },
      );
      if (error) throw error;
      results.push({ slug, ok: true });
    } catch (e) {
      results.push({ slug, ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  }

  return new Response(JSON.stringify({ count: results.length, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
