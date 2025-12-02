// ============================================
// OZLON ORB OS - INITIALIZATION
// ============================================
// Initialize all core systems and registries.

import { registerDefaultAgents } from "./agents";
import { registerIntegrationHooks } from "./hooks/integrations";
import { registerRealityHooks } from "./hooks/reality";
import { registerMultimodalHooks } from "./hooks/multimodal";
import { registerRoutineHooks } from "./hooks/routines";
import { registerDefaultCommands } from "./commands";
import { registerDefaultCards } from "./cards";
import { getRegistrySummary } from "./registry";

let initialized = false;

/**
 * Initialize the Orb OS core systems
 * Call this once at app startup
 */
export function initializeOrbOS(): void {
  if (initialized) {
    console.warn("[OrbOS] Already initialized");
    return;
  }

  console.log("[OrbOS] Initializing...");

  // Register all default components
  registerDefaultAgents();
  registerIntegrationHooks();
  registerRealityHooks();
  registerMultimodalHooks();
  registerRoutineHooks();
  registerDefaultCommands();
  registerDefaultCards();

  initialized = true;

  // Log summary
  const summary = getRegistrySummary();
  console.log("[OrbOS] Initialization complete:", summary);
}

/**
 * Check if OrbOS is initialized
 */
export function isOrbOSInitialized(): boolean {
  return initialized;
}

/**
 * Reset OrbOS (for testing)
 */
export function resetOrbOS(): void {
  initialized = false;
  console.log("[OrbOS] Reset");
}
