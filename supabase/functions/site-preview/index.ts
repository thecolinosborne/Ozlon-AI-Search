// Public "See your next website" generator. Scrapes a site, asks the AI to
// redesign its homepage as a single static HTML file, stores it, and lets the
// visitor optionally leave contact details to keep it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function normalizeUrl(raw: string): URL | null {
  try {
    let s = String(raw || "").trim();
    if (!s || s.length > 300) return null;
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes(".") || h === "localhost" || /^(\d+\.){3}\d+$/.test(h) || h.endsWith(".local") || h.endsWith(".internal")) return null;
    return u;
  } catch { return null; }
}

function sanitize(html: string): string {
  let h = html.trim();
  const fence = h.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) h = fence[1].trim();
  const start = h.search(/<!doctype html|<html/i);
  if (start > 0) h = h.slice(start);
  // No scripts, no inline handlers, no javascript: URLs, no embedded frames.
  h = h.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/<(iframe|object|embed)[\s\S]*?(<\/\1>|\/>|>)/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
  return h;
}

async function scrape(url: string) {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("Site reader is not configured");
  const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "branding", "links"], onlyMainContent: false, timeout: 30000 }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("We couldn't open that website. Check the address and try again.");
  const data = d.data ?? d;
  return {
    markdown: String(data.markdown ?? "").slice(0, 14000),
    branding: data.branding ?? null,
    title: data.metadata?.title ?? "",
    description: data.metadata?.description ?? "",
    links: (data.links ?? []).slice(0, 40),
  };
}

async function design(url: string, site: Awaited<ReturnType<typeof scrape>>) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("AI is not configured");
  const brand = site.branding ? JSON.stringify({
    colors: site.branding.colors, fonts: site.branding.fonts, logo: site.branding.logo ?? site.branding.images?.logo,
  }) : "unknown";
  const prompt = `Redesign the homepage of ${url} as a stunning, modern, high-end website.

Return ONE complete HTML document only (start with <!DOCTYPE html>). Rules:
- Use only inline <style> CSS. NO JavaScript at all. Google Fonts <link> is allowed.
- Pick a distinctive, premium visual direction that suits this business (not generic purple gradients). Keep their brand colors and logo if they look good, refine them otherwise.
- Sections: sticky nav, bold hero with a clear headline and primary call to action (Book / Call / Get a quote — whatever fits), services, social proof/reviews, about, a strong final call to action, footer with real contact details.
- Use ONLY the real business name, services, phone, address, hours and testimonials found in the content below. Never invent phone numbers, prices or reviews; if missing, write tasteful generic copy without fake specifics.
- Images: use the logo URL if provided; otherwise use CSS gradients, shapes and subtle patterns (no external stock photo URLs).
- Fully responsive (mobile-first), CSS animations allowed (fade-in, hover lift). Accessible contrast.
- Keep it under ~900 lines.

Current brand: ${brand}
Page title: ${site.title}
Description: ${site.description}

Current website content:
${site.markdown}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-6-astra", reasoning: { effort: "low" }, input: prompt }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 429) throw new Error("Lots of people are trying this right now. Try again in a minute.");
  if (r.status === 402) throw new Error("The design studio is paused right now. Please try again later.");
  if (!r.ok) { console.error("ai error", r.status, JSON.stringify(d).slice(0, 500)); throw new Error("The designer had trouble with this one. Try again."); }
  let text = d.output_text ?? "";
  if (!text && Array.isArray(d.output)) {
    for (const o of d.output) for (const c of o.content ?? []) if (c.type === "output_text") text += c.text;
  }
  const html = sanitize(text);
  if (!/<html|<body/i.test(html) || html.length < 800) throw new Error("The designer returned an incomplete page. Try again.");
  const nameMatch = html.match(/<title>([^<]{1,120})<\/title>/i);
  return { html, name: nameMatch?.[1]?.split(/[|\-–—]/)[0].trim() || site.title || null };
}

// Push the lead into GoHighLevel as a contact with the design link attached.
async function sendToCrm(sb: ReturnType<typeof db>, id: string, name: string, email: string, phone: string) {
  const key = Deno.env.get("GHL_API_KEY"), loc = Deno.env.get("GHL_LOCATION_ID");
  if (!key || !loc) return "not_configured";
  const { data: row } = await sb.from("website_previews").select("source_url,domain").eq("id", id).maybeSingle();
  const h = { Authorization: `Bearer ${key}`, Version: "2021-07-28", "Content-Type": "application/json" };
  const [firstName, ...rest] = name.split(/\s+/);
  try {
    const r = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST", headers: h,
      body: JSON.stringify({ locationId: loc, firstName, lastName: rest.join(" ") || undefined, email, phone: phone || undefined,
        website: row?.source_url, source: "Website Preview Tool", tags: ["website-preview", "inbound-lead"] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("ghl upsert", r.status, JSON.stringify(d).slice(0, 300)); return "failed"; }
    const cid = d.contact?.id;
    if (cid) {
      await fetch(`https://services.leadconnectorhq.com/contacts/${cid}/notes`, {
        method: "POST", headers: h,
        body: JSON.stringify({ body: `Requested a website redesign preview for ${row?.domain}.\nView their design: https://ozlon.ai/preview/${id}` }),
      }).catch(() => {});
    }
    return "sent";
  } catch (e) { console.error("ghl", e); return "failed"; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "generate";
    const sb = db();

    if (action === "get") {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.id))) return json({ error: "Not found" }, 404);
      const { data } = await sb.from("website_previews").select("id,source_url,domain,business_name,html,status,error").eq("id", body.id).maybeSingle();
      if (!data) return json({ error: "Not found" }, 404);
      return json(data);
    }

    if (action === "claim") {
      const id = String(body.id ?? "");
      const name = String(body.name ?? "").trim().slice(0, 100);
      const email = String(body.email ?? "").trim().slice(0, 255);
      const phone = String(body.phone ?? "").trim().slice(0, 40);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Not found" }, 404);
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please add your name and a valid email." }, 400);
      if (phone && !/^[0-9+().\-\s]{7,40}$/.test(phone)) return json({ error: "That phone number doesn't look right." }, 400);
      const { error } = await sb.from("website_previews").update({ lead_name: name, lead_email: email, lead_phone: phone || null, lead_at: new Date().toISOString() }).eq("id", id);
      if (error) return json({ error: "Couldn't save. Try again." }, 500);
      const crm = await sendToCrm(sb, id, name, email, phone);
      return json({ ok: true, crm });
    }

    // generate
    const u = normalizeUrl(body.url);
    if (!u) return json({ error: "Enter a valid website address, like yourbusiness.com" }, 400);
    const domain = u.hostname.replace(/^www\./, "");
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const ipHash = await sha(ip + "ozlon-preview");

    // Reuse a recent design for the same site (saves cost, instant result).
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const { data: cached } = await sb.from("website_previews").select("id,business_name,html,domain,source_url")
      .eq("domain", domain).eq("status", "ready").gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (cached && !body.fresh) return json({ ...cached, cached: true });

    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const { count } = await sb.from("website_previews").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", hourAgo);
    if ((count ?? 0) >= 5) return json({ error: "You've made several designs this hour. Try again a little later." }, 429);

    const { data: row } = await sb.from("website_previews").insert({ source_url: u.toString(), domain, ip_hash: ipHash, status: "working" }).select("id").single();
    try {
      const site = await scrape(u.toString());
      if (site.markdown.length < 80) throw new Error("That website didn't have enough content to work from.");
      const out = await design(u.toString(), site);
      await sb.from("website_previews").update({ html: out.html, business_name: out.name, status: "ready" }).eq("id", row!.id);
      return json({ id: row!.id, html: out.html, business_name: out.name, domain, source_url: u.toString() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      await sb.from("website_previews").update({ status: "failed", error: msg }).eq("id", row!.id);
      return json({ error: msg }, 502);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
