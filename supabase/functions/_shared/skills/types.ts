// Skill manifest types — proprietary Ozlon Skill format.
// A skill is a scoped instruction packet that composes existing tools.

export type SkillTrigger =
  | { type: "keyword"; match: string[] }
  | { type: "intent"; match: string }
  | { type: "signal"; match: string };

export type SkillSideEffect = "read" | "write" | "destructive";

export interface SkillManifest {
  slug: string;
  name: string;
  description: string;
  version: string;
  triggers: SkillTrigger[];
  tools_required: string[];
  tools_optional?: string[];
  memory_domains?: string[];
  modes_allowed?: Array<"focus" | "idle" | "planning" | "reactive">;
  instructions: string;
  side_effect?: SkillSideEffect;
  requires_confirmation?: boolean;
}

export interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  manifest: SkillManifest;
  source: "builtin" | "user" | "imported";
  author_user_id: string | null;
  visibility: "private" | "org" | "public";
  trust_tier: 0 | 1 | 2;
}

export interface SkillIndexEntry {
  slug: string;
  name: string;
  description: string;
}
