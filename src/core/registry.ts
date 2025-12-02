// ============================================
// OZLON ORB OS - CENTRAL REGISTRY
// ============================================
// The registry is the backbone of the modular OS.
// All agents, cards, hooks, and plugins register here.

import type {
  AgentConfig,
  CardConfig,
  HookConfig,
  Command,
  PluginConfig,
  RoutineConfig,
} from "./types";

// ============================================
// AGENT REGISTRY
// ============================================

const agentRegistry = new Map<string, AgentConfig>();

/**
 * Register a new agent with the OS
 * @param config - Agent configuration
 * @example
 * registerAgent({
 *   id: "finance-agent",
 *   name: "Finance Agent",
 *   description: "Handles financial analysis",
 *   version: "1.0.0",
 *   enabled: true,
 *   category: "finance",
 *   capabilities: ["analyze-spending", "track-bills", "detect-subscriptions"]
 * });
 */
export function registerAgent(config: AgentConfig): void {
  if (agentRegistry.has(config.id)) {
    console.warn(`[Registry] Agent "${config.id}" already registered. Overwriting.`);
  }
  agentRegistry.set(config.id, config);
  console.log(`[Registry] Agent registered: ${config.name}`);
}

export function unregisterAgent(agentId: string): boolean {
  return agentRegistry.delete(agentId);
}

export function getAgent(agentId: string): AgentConfig | undefined {
  return agentRegistry.get(agentId);
}

export function getAllAgents(): AgentConfig[] {
  return Array.from(agentRegistry.values());
}

export function getEnabledAgents(): AgentConfig[] {
  return getAllAgents().filter((a) => a.enabled);
}

export function getAgentsByCategory(category: string): AgentConfig[] {
  return getAllAgents().filter((a) => a.category === category);
}

// ============================================
// CARD REGISTRY
// ============================================

const cardRegistry = new Map<string, CardConfig>();

/**
 * Register a dashboard card
 * @param config - Card configuration
 * @example
 * registerCard({
 *   id: "time-engine",
 *   name: "Time Engine",
 *   description: "Today's schedule and tasks",
 *   category: "time",
 *   component: "TimeEngineCard",
 *   size: "medium",
 *   priority: 1,
 *   enabled: true,
 *   dataSource: "fetchCalendar"
 * });
 */
export function registerCard(config: CardConfig): void {
  if (cardRegistry.has(config.id)) {
    console.warn(`[Registry] Card "${config.id}" already registered. Overwriting.`);
  }
  cardRegistry.set(config.id, config);
  console.log(`[Registry] Card registered: ${config.name}`);
}

export function unregisterCard(cardId: string): boolean {
  return cardRegistry.delete(cardId);
}

export function getCard(cardId: string): CardConfig | undefined {
  return cardRegistry.get(cardId);
}

export function getAllCards(): CardConfig[] {
  return Array.from(cardRegistry.values());
}

export function getEnabledCards(): CardConfig[] {
  return getAllCards().filter((c) => c.enabled);
}

export function getCardsByCategory(category: string): CardConfig[] {
  return getAllCards().filter((c) => c.category === category);
}

// ============================================
// HOOK REGISTRY
// ============================================

const hookRegistry = new Map<string, HookConfig>();

/**
 * Register an integration hook
 * @param config - Hook configuration
 * @example
 * registerHook({
 *   id: "fetch-calendar",
 *   name: "Fetch Calendar",
 *   description: "Retrieves calendar events",
 *   category: "integration",
 *   enabled: true,
 *   handler: async (params) => { ... }
 * });
 */
export function registerHook(config: HookConfig): void {
  if (hookRegistry.has(config.id)) {
    console.warn(`[Registry] Hook "${config.id}" already registered. Overwriting.`);
  }
  hookRegistry.set(config.id, config);
  console.log(`[Registry] Hook registered: ${config.name}`);
}

export function unregisterHook(hookId: string): boolean {
  return hookRegistry.delete(hookId);
}

export function getHook(hookId: string): HookConfig | undefined {
  return hookRegistry.get(hookId);
}

export function getAllHooks(): HookConfig[] {
  return Array.from(hookRegistry.values());
}

export function getEnabledHooks(): HookConfig[] {
  return getAllHooks().filter((h) => h.enabled);
}

export function getHooksByCategory(category: string): HookConfig[] {
  return getAllHooks().filter((h) => h.category === category);
}

/**
 * Execute a registered hook by ID
 * @param hookId - The hook identifier
 * @param input - Input data for the hook
 */
export async function executeHook(hookId: string, input: unknown): Promise<unknown> {
  const hook = hookRegistry.get(hookId);
  if (!hook) {
    console.error(`[Registry] Hook not found: ${hookId}`);
    return null;
  }
  if (!hook.enabled) {
    console.warn(`[Registry] Hook disabled: ${hookId}`);
    return null;
  }
  try {
    return await hook.handler(input);
  } catch (error) {
    console.error(`[Registry] Hook execution failed: ${hookId}`, error);
    throw error;
  }
}

// ============================================
// COMMAND REGISTRY
// ============================================

const commandRegistry = new Map<string, Command>();

/**
 * Register a command for the command palette
 * @param command - Command configuration
 */
export function registerCommand(command: Command): void {
  if (commandRegistry.has(command.id)) {
    console.warn(`[Registry] Command "${command.id}" already registered. Overwriting.`);
  }
  commandRegistry.set(command.id, command);
}

export function unregisterCommand(commandId: string): boolean {
  return commandRegistry.delete(commandId);
}

export function getCommand(commandId: string): Command | undefined {
  return commandRegistry.get(commandId);
}

export function getAllCommands(): Command[] {
  return Array.from(commandRegistry.values());
}

export function searchCommands(query: string): Command[] {
  const lowerQuery = query.toLowerCase();
  return getAllCommands().filter(
    (c) =>
      c.label.toLowerCase().includes(lowerQuery) ||
      c.description?.toLowerCase().includes(lowerQuery) ||
      c.category.toLowerCase().includes(lowerQuery)
  );
}

// ============================================
// ROUTINE REGISTRY
// ============================================

const routineRegistry = new Map<string, RoutineConfig>();

/**
 * Register an autonomous routine
 * @param config - Routine configuration
 */
export function registerRoutine(config: RoutineConfig): void {
  if (routineRegistry.has(config.id)) {
    console.warn(`[Registry] Routine "${config.id}" already registered. Overwriting.`);
  }
  routineRegistry.set(config.id, config);
  console.log(`[Registry] Routine registered: ${config.name}`);
}

export function unregisterRoutine(routineId: string): boolean {
  return routineRegistry.delete(routineId);
}

export function getRoutine(routineId: string): RoutineConfig | undefined {
  return routineRegistry.get(routineId);
}

export function getAllRoutines(): RoutineConfig[] {
  return Array.from(routineRegistry.values());
}

export function getEnabledRoutines(): RoutineConfig[] {
  return getAllRoutines().filter((r) => r.enabled);
}

// ============================================
// PLUGIN REGISTRY
// ============================================

const pluginRegistry = new Map<string, PluginConfig>();

/**
 * Register a plugin that bundles agents, cards, hooks, and commands
 * @param config - Plugin configuration
 */
export function registerPlugin(config: PluginConfig): void {
  if (pluginRegistry.has(config.id)) {
    console.warn(`[Registry] Plugin "${config.id}" already registered. Overwriting.`);
  }

  // Register all plugin components
  config.agents?.forEach(registerAgent);
  config.cards?.forEach(registerCard);
  config.hooks?.forEach(registerHook);
  config.commands?.forEach(registerCommand);

  pluginRegistry.set(config.id, config);
  console.log(`[Registry] Plugin registered: ${config.name}`);
}

export function unregisterPlugin(pluginId: string): boolean {
  const plugin = pluginRegistry.get(pluginId);
  if (!plugin) return false;

  // Unregister all plugin components
  plugin.agents?.forEach((a) => unregisterAgent(a.id));
  plugin.cards?.forEach((c) => unregisterCard(c.id));
  plugin.hooks?.forEach((h) => unregisterHook(h.id));
  plugin.commands?.forEach((c) => unregisterCommand(c.id));

  return pluginRegistry.delete(pluginId);
}

export function getAllPlugins(): PluginConfig[] {
  return Array.from(pluginRegistry.values());
}

// ============================================
// REGISTRY SUMMARY
// ============================================

export function getRegistrySummary() {
  return {
    agents: getAllAgents().length,
    enabledAgents: getEnabledAgents().length,
    cards: getAllCards().length,
    enabledCards: getEnabledCards().length,
    hooks: getAllHooks().length,
    enabledHooks: getEnabledHooks().length,
    commands: getAllCommands().length,
    routines: getAllRoutines().length,
    plugins: getAllPlugins().length,
  };
}

/**
 * Clear all registries - useful for testing
 */
export function clearAllRegistries(): void {
  agentRegistry.clear();
  cardRegistry.clear();
  hookRegistry.clear();
  commandRegistry.clear();
  routineRegistry.clear();
  pluginRegistry.clear();
  console.log("[Registry] All registries cleared");
}
