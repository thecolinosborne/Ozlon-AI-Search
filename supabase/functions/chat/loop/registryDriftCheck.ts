// Boot-time sanity check: every declared tool must have a handler
// (either a switch case in executeToolCall, a manifest-routed prefix,
// a native Google route, or one of the non-legacy meta-tools).
//
// Pure utility — no module-level side effects. Caller invokes once at boot
// and stores the resulting report wherever it wants to expose it.

export interface DriftReport {
  missingCases: string[];
  orphanCases: string[];
}

export interface DriftInput {
  /** Source string of executeToolCall (typically `executeToolCall.toString()`). */
  executeToolCallSource: string;
  /** Declared tool names — usually ACTION_TOOLS.map(t => t.function.name). */
  declaredToolNames: string[];
  /** Native Google route keys (route bypasses the switch). */
  nativeGoogleRouteKeys: string[];
  /** Extra meta-tools that are intentionally not in the switch. */
  nonLegacyTools?: string[];
  /** Manifest-routed name prefixes (gmail_, ghl_, clickup_, ...). */
  manifestPrefixes?: string[];
}

const DEFAULT_NON_LEGACY = [
  "multi_action",
  "load_skill",
  "web_investigate",
  "personal_research",
];

const DEFAULT_MANIFEST_PREFIXES = [
  "gmail_",
  "ghl_",
  "clickup_",
  "list_clickup_",
  "get_clickup_",
  "create_clickup_",
  "update_clickup_",
  "delete_clickup_",
  "set_clickup_",
  "search_clickup_",
  "move_clickup_",
  "add_clickup_",
  "remove_clickup_",
  "start_clickup_",
  "stop_clickup_",
];

export function checkRegistryDrift(input: DriftInput): DriftReport {
  const report: DriftReport = { missingCases: [], orphanCases: [] };
  try {
    const caseNames = new Set<string>();
    const caseRe = /case\s+['"]([a-zA-Z0-9_]+)['"]\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = caseRe.exec(input.executeToolCallSource)) !== null) {
      caseNames.add(m[1]);
    }

    const nonLegacy = new Set<string>([
      ...DEFAULT_NON_LEGACY,
      ...(input.nonLegacyTools ?? []),
      ...input.nativeGoogleRouteKeys,
    ]);
    const prefixes = input.manifestPrefixes ?? DEFAULT_MANIFEST_PREFIXES;
    const isManifestRouted = (name: string): boolean =>
      prefixes.some((p) => name.startsWith(p));

    const declared = new Set(input.declaredToolNames);

    for (const name of declared) {
      if (nonLegacy.has(name) || isManifestRouted(name)) continue;
      if (!caseNames.has(name)) report.missingCases.push(name);
    }
    for (const name of caseNames) {
      if (!declared.has(name) && !nonLegacy.has(name) && !isManifestRouted(name)) {
        report.orphanCases.push(name);
      }
    }

    if (report.missingCases.length === 0 && report.orphanCases.length === 0) {
      console.log(
        `[registry-drift] OK — ${declared.size} tools, ${caseNames.size} cases, no drift`,
      );
    } else {
      if (report.missingCases.length > 0) {
        console.error(
          `[registry-drift] ${report.missingCases.length} tools declared without a handler: ${report.missingCases.join(", ")}`,
        );
      }
      if (report.orphanCases.length > 0) {
        console.warn(
          `[registry-drift] ${report.orphanCases.length} orphan cases (handler exists but tool not declared): ${report.orphanCases.join(", ")}`,
        );
      }
    }
  } catch (e) {
    console.warn(
      "[registry-drift] check failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
  return report;
}
