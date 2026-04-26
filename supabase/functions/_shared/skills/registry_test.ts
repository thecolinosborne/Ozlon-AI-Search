import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { filterSkillsByMode } from "./registry.ts";
import type { SkillRow } from "./types.ts";

function mk(slug: string, modes_allowed?: string[]): SkillRow {
  return {
    id: slug,
    slug,
    name: slug,
    description: slug,
    version: "1.0.0",
    // deno-lint-ignore no-explicit-any
    manifest: { slug, name: slug, description: slug, version: "1.0.0", triggers: [], tools_required: [], instructions: "x".repeat(40), modes_allowed } as any,
    source: "user",
    author_user_id: null,
    visibility: "private",
    trust_tier: 1,
  };
}

const FOCUS_ONLY = mk("focus-only", ["focus"]);
const FOCUS_PLAN = mk("focus-plan", ["focus", "planning"]);
const ANY_EMPTY = mk("any-empty", []);
const ANY_UNDEF = mk("any-undef", undefined);

const ALL = [FOCUS_ONLY, FOCUS_PLAN, ANY_EMPTY, ANY_UNDEF];

Deno.test("null mode → all skills allowed", () => {
  assertEquals(filterSkillsByMode(ALL, null).length, 4);
});

Deno.test("empty/undefined modes_allowed → always allowed", () => {
  for (const mode of ["focus", "idle", "planning", "reactive"]) {
    const out = filterSkillsByMode(ALL, mode);
    assert(out.includes(ANY_EMPTY), `ANY_EMPTY missing in ${mode}`);
    assert(out.includes(ANY_UNDEF), `ANY_UNDEF missing in ${mode}`);
  }
});

Deno.test("focus-only blocked in non-focus modes", () => {
  for (const mode of ["idle", "planning", "reactive"]) {
    const out = filterSkillsByMode(ALL, mode);
    assert(!out.includes(FOCUS_ONLY), `FOCUS_ONLY leaked into ${mode}`);
  }
  assert(filterSkillsByMode(ALL, "focus").includes(FOCUS_ONLY));
});

Deno.test("multi-mode skill allowed in each listed mode", () => {
  assert(filterSkillsByMode(ALL, "focus").includes(FOCUS_PLAN));
  assert(filterSkillsByMode(ALL, "planning").includes(FOCUS_PLAN));
  assert(!filterSkillsByMode(ALL, "idle").includes(FOCUS_PLAN));
  assert(!filterSkillsByMode(ALL, "reactive").includes(FOCUS_PLAN));
});

Deno.test("matrix: 4 modes × 4 fixtures", () => {
  const expected: Record<string, string[]> = {
    focus:    ["focus-only", "focus-plan", "any-empty", "any-undef"],
    planning: ["focus-plan", "any-empty", "any-undef"],
    idle:     ["any-empty", "any-undef"],
    reactive: ["any-empty", "any-undef"],
  };
  for (const [mode, slugs] of Object.entries(expected)) {
    const got = filterSkillsByMode(ALL, mode).map((s) => s.slug).sort();
    assertEquals(got, [...slugs].sort(), `mode=${mode}`);
  }
});
