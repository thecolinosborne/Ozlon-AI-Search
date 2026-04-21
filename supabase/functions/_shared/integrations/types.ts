// Integration manifest types — single source of truth for tool routing.
// Each integration declares its tools, the edge function they hit, the
// envelope shape the receiver expects, and how to map AI args → API params.

export type Envelope = "nested" | "flat";
// nested → { action, params: { ...mapped } }   ← Google services, Descript-new
// flat   → { action, ...mapped }               ← legacy receivers

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
}
