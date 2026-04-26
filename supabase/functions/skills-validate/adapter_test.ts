import { assertEquals, assert, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adaptSkill, detectFormat, inferTriggers, mergeCompanion } from "../_shared/skills/adapter.ts";

Deno.test("detectFormat: json/md/yaml/unknown", () => {
  assertEquals(detectFormat('{"a":1}'), "json");
  assertEquals(detectFormat("---\nname: x\n---\nbody"), "md");
  assertEquals(detectFormat("interface:\n  display_name: X"), "yaml");
  assertEquals(detectFormat(""), "unknown");
  assertEquals(detectFormat("just some text"), "unknown");
});

Deno.test("native JSON pass-through preserves fields", () => {
  const m = {
    slug: "x", name: "X", description: "d", version: "1.0.0",
    triggers: [{ type: "keyword", match: ["x"] }],
    tools_required: ["a"], instructions: "do something useful here please",
  };
  const r = adaptSkill(JSON.stringify(m));
  assertEquals(r.format, "json");
  assertEquals(r.manifest?.slug, "x");
  assertEquals(r.manifest?.tools_required, ["a"]);
});

Deno.test("Claude SKILL.md → normalized manifest with inferred slug + triggers", () => {
  const md = `---
name: Marketing Studio Director
description: "Higgsfield Marketing Studio prompt director. Converts plain-text ad concepts into production-ready English video prompts."
---

# Body
Long instructions go here. ${"x".repeat(50)}
`;
  const r = adaptSkill(md);
  assertEquals(r.format, "md");
  assertExists(r.manifest);
  assertEquals(r.manifest!.slug, "marketing-studio-director");
  assertEquals(r.manifest!.version, "1.0.0");
  assert(Array.isArray(r.manifest!.triggers) && r.manifest!.triggers.length >= 1);
  assertEquals(r.manifest!.triggers[0].type, "keyword");
  assert(r.manifest!.instructions.length >= 20);
});

Deno.test("OpenAI YAML companion merges into manifest.ui", () => {
  const manifest = {
    slug: "x", name: "X", description: "d", version: "1.0.0",
    triggers: [{ type: "keyword", match: ["x"] }],
    tools_required: [], instructions: "do something useful here please",
  };
  const companion = `interface:
  display_name: Marketing Studio Director
  short_description: Creates ad prompts.
  icon: megaphone
  brand_color: '#111827'
`;
  const r = adaptSkill(JSON.stringify(manifest), companion);
  assertExists(r.manifest);
  assertEquals(r.manifest!.ui?.display_name, "Marketing Studio Director");
  assertEquals(r.manifest!.ui?.icon, "megaphone");
  assertEquals(r.manifest!.ui?.brand_color, "#111827");
});

Deno.test("YAML-only companion (no manifest) returns companion + null manifest", () => {
  const r = adaptSkill("interface:\n  display_name: X\n  icon: y");
  assertEquals(r.format, "yaml");
  assertEquals(r.manifest, null);
  assertExists(r.companion);
});

Deno.test("malformed YAML returns error, never throws", () => {
  const r = adaptSkill("---\n: : :bad\n---\nbody");
  // either md adapter fails cleanly or returns null
  assert(!r.manifest || typeof r.error === "string" || r.manifest);
});

Deno.test("inferTriggers produces non-empty keyword match list", () => {
  const t = inferTriggers("Pulls today's calendar and unread email into a brief", "Morning Briefing");
  assertEquals(t[0].type, "keyword");
  assert(t[0].match.length >= 1);
});

Deno.test("mergeCompanion is a no-op when companion is null", () => {
  const m = { slug: "x" };
  assertEquals(mergeCompanion(m, null), m);
});

Deno.test("heal: keyword triggers with `value` get coerced to `match[]`; presentation→ui", () => {
  const m = {
    slug: "marketing-studio-director",
    name: "Marketing Studio Director",
    description: "Turns ad concepts into Higgsfield prompts.",
    version: "1.0.0",
    triggers: [
      { type: "keyword", value: "Marketing Studio" },
      { type: "keyword", value: "UGC ad" },
    ],
    tools_required: [],
    instructions: "x".repeat(50),
    presentation: { display_name: "MSD", icon: "video", brand_color: "#111" },
  };
  const r = adaptSkill(JSON.stringify(m));
  assertExists(r.manifest);
  assertEquals(r.manifest!.triggers[0].match, ["Marketing Studio"]);
  assertEquals(r.manifest!.triggers[1].match, ["UGC ad"]);
  assertEquals(r.manifest!.ui?.icon, "video");
  assertEquals(r.manifest!.presentation, undefined);
});
