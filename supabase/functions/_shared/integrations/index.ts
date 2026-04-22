// Integration registry — barrel that aggregates every manifest.
// Add a new integration by:
//   1. dropping a manifest file in this folder,
//   2. importing + listing it below.
// The chat function picks it up automatically (tool defs + dispatcher routes).

import type { CompiledRoute, IntegrationManifest, ToolManifest } from "./types.ts";

import { googleDocsIntegration } from "./google-docs.ts";
import { googleSheetsIntegration } from "./google-sheets.ts";
import { googleCalendarIntegration } from "./google-calendar.ts";
import { googleSlidesIntegration } from "./google-slides.ts";
import { googleDriveIntegration } from "./google-drive.ts";
import { googleAnalyticsIntegration } from "./google-analytics.ts";
import { googleTagManagerIntegration } from "./google-tag-manager.ts";
import { descriptIntegration } from "./descript.ts";
import { searchAtlasIntegration } from "./search-atlas.ts";
import { slackIntegration } from "./slack.ts";
import { gmailIntegration } from "./gmail.ts";
import { clickupIntegration } from "./clickup.ts";

export const INTEGRATIONS: IntegrationManifest[] = [
  googleDocsIntegration,
  googleSheetsIntegration,
  googleCalendarIntegration,
  googleSlidesIntegration,
  googleDriveIntegration,
  googleAnalyticsIntegration,
  googleTagManagerIntegration,
  descriptIntegration,
  searchAtlasIntegration,
  slackIntegration,
  gmailIntegration,
  clickupIntegration,
];

/** Map: tool name → compiled route. Built once at module load. */
export const TOOL_REGISTRY: Map<string, CompiledRoute> = (() => {
  const m = new Map<string, CompiledRoute>();
  for (const integ of INTEGRATIONS) {
    for (const t of integ.tools) {
      if (m.has(t.name)) {
        console.warn(`[registry] duplicate tool name: ${t.name} (overriding)`);
      }
      const sideEffect = t.sideEffect ?? "read";
      m.set(t.name, {
        integrationId: integ.id,
        edgeFunction: integ.edgeFunction,
        envelope: integ.envelope,
        action: t.action,
        mapArgs: t.mapArgs ?? ((a) => a),
        formatter: t.formatter,
        sideEffect,
        cost: t.cost ?? "cheap",
        requiresConfirmation: t.requiresConfirmation ?? sideEffect === "destructive",
        toolName: t.name,
      });
    }
  }
  return m;
})();

/** All tool manifests across all integrations (for OpenAI tool definitions). */
export function getAllRegisteredTools(): ToolManifest[] {
  return INTEGRATIONS.flatMap((i) => i.tools);
}

/** Lookup: returns null if not registered. */
export function getRoute(toolName: string): CompiledRoute | null {
  return TOOL_REGISTRY.get(toolName) ?? null;
}
