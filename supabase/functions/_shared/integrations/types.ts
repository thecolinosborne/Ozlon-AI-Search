// Integration manifest types — single source of truth for tool routing,
// formatting, cost, and safety. Adding an integration = dropping a manifest
// file. The dispatcher honors every field below; chat/index.ts never changes.

export type Envelope = "nested" | "flat";
// nested → { action, params: { ...mapped } }   ← Google services, Descript-new
// flat   → { action, ...mapped }               ← legacy receivers

/** What kind of work the tool does — drives auto-confirm + parallelism. */
export type SideEffect =
  | "read"          // safe, idempotent, parallelizable, no confirm needed
  | "write"         // creates/updates external state — confirm by default
  | "destructive"   // deletes/sends/charges — ALWAYS confirm
  | "external_call"; // costly read (search, AI inference) — parallelizable

/** Rough cost class — lets the orchestrator batch cheap reads aggressively. */
export type CostHint = "free" | "cheap" | "moderate" | "expensive";

/** Formatter shapes raw API JSON into AI-friendly text.
 *  Returning null/empty falls back to the dispatcher's default JSON slice. */
export type ToolFormatter = (
  data: unknown,
  args: Record<string, unknown>,
) => string | null;

export interface ToolManifest {
  /** Tool name exposed to the AI (e.g. "docs_insert_text"). */
  name: string;
  /** OpenAI function description. */
  description: string;
  /** OpenAI function JSON schema. */
  schema: Record<string, unknown>;
  /** Action name the receiving edge function dispatches on. */
  action: string;
  /** Optional arg mapper. Default: pass args through unchanged. */
  mapArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Optional formatter for raw API → AI-friendly text. Prevents format regressions. */
  formatter?: ToolFormatter;
  /** What kind of work this performs. Default: "read". */
  sideEffect?: SideEffect;
  /** Rough cost class. Default: "cheap". */
  cost?: CostHint;
  /** OAuth scopes (or capability string) this tool requires. Informational. */
  authScope?: string[];
  /** Force AI to confirm with user before executing. Auto-true for "destructive". */
  requiresConfirmation?: boolean;
}

export interface IntegrationManifest {
  /** Stable internal id (e.g. "google-docs"). */
  id: string;
  /** Display label (used by frontend auto-discovery). */
  displayName: string;
  /** Edge function name to invoke (under supabase/functions/<name>). */
  edgeFunction: string;
  /** Envelope shape the receiver expects. */
  envelope: Envelope;
  /** Tools this integration exposes to the AI. */
  tools: ToolManifest[];
}

export interface CompiledRoute {
  integrationId: string;
  edgeFunction: string;
  envelope: Envelope;
  action: string;
  mapArgs: (args: Record<string, unknown>) => Record<string, unknown>;
  formatter?: ToolFormatter;
  sideEffect: SideEffect;
  cost: CostHint;
  requiresConfirmation: boolean;
  toolName: string;
}
