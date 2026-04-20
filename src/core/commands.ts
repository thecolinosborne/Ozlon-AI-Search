// ============================================
// OZLON ORB OS - DEFAULT COMMANDS
// ============================================
// Commands for the global command palette.

import { registerCommand, getAllCommands, searchCommands } from "./registry";
import type { Command } from "./types";

// ============================================
// NAVIGATION COMMANDS
// ============================================

const navigationCommands: Omit<Command, "handler">[] = [
  {
    id: "go-home",
    label: "Go to Home",
    description: "Navigate to the home dashboard",
    icon: "Home",
    shortcut: "G H",
    category: "Navigation",
  },
  {
    id: "go-chat",
    label: "Go to Chat",
    description: "Navigate to the chat interface",
    icon: "MessageSquare",
    shortcut: "G C",
    category: "Navigation",
  },
  {
    id: "go-settings",
    label: "Go to Settings",
    description: "Navigate to settings",
    icon: "Settings",
    shortcut: "G S",
    category: "Navigation",
  },
  {
    id: "go-developer",
    label: "Go to Developer Mode",
    description: "Navigate to developer settings",
    icon: "Code",
    shortcut: "G D",
    category: "Navigation",
  },
  {
    id: "go-memory",
    label: "Go to Memory Settings",
    description: "Navigate to memory configuration",
    icon: "Brain",
    shortcut: "G M",
    category: "Navigation",
  },
  {
    id: "go-wisdom",
    label: "Go to Wisdom Library",
    description: "Ingest minds and frameworks into the OS",
    icon: "Brain",
    shortcut: "G W",
    category: "Navigation",
  },
];

// ============================================
// AGENT COMMANDS
// ============================================

const agentCommands: Omit<Command, "handler">[] = [
  {
    id: "analyze-finances",
    label: "Analyze my finances",
    description: "Get financial insights and spending analysis",
    icon: "DollarSign",
    category: "Agents",
  },
  {
    id: "summarize-today",
    label: "Summarize today",
    description: "Get a summary of today's activities",
    icon: "Calendar",
    category: "Agents",
  },
  {
    id: "find-tasks",
    label: "Find tasks",
    description: "Search through your tasks",
    icon: "CheckSquare",
    category: "Agents",
  },
  {
    id: "draft-email",
    label: "Draft an email",
    description: "Start drafting a new email",
    icon: "Mail",
    category: "Agents",
  },
  {
    id: "check-opportunities",
    label: "Check opportunities",
    description: "Find opportunities and weak signals",
    icon: "Lightbulb",
    category: "Agents",
  },
  {
    id: "pattern-analysis",
    label: "Run pattern analysis",
    description: "Analyze patterns in your behavior",
    icon: "Activity",
    category: "Agents",
  },
  {
    id: "memory-recall",
    label: "Recall memory",
    description: "Search your memory and history",
    icon: "Search",
    category: "Agents",
  },
];

// ============================================
// ROUTINE COMMANDS
// ============================================

const routineCommands: Omit<Command, "handler">[] = [
  {
    id: "morning-brief",
    label: "Morning brief",
    description: "Get your morning briefing",
    icon: "Sunrise",
    category: "Routines",
  },
  {
    id: "evening-review",
    label: "Evening review",
    description: "Review your day and plan tomorrow",
    icon: "Moon",
    category: "Routines",
  },
  {
    id: "weekly-review",
    label: "Weekly review",
    description: "Review your week",
    icon: "Calendar",
    category: "Routines",
  },
];

// ============================================
// ACTION COMMANDS
// ============================================

const actionCommands: Omit<Command, "handler">[] = [
  {
    id: "new-task",
    label: "Create new task",
    description: "Add a new task to your list",
    icon: "Plus",
    shortcut: "N T",
    category: "Actions",
  },
  {
    id: "new-note",
    label: "Create new note",
    description: "Start a new note",
    icon: "FileText",
    shortcut: "N N",
    category: "Actions",
  },
  {
    id: "voice-input",
    label: "Voice input",
    description: "Start voice recording",
    icon: "Mic",
    shortcut: "V",
    category: "Actions",
  },
  {
    id: "upload-image",
    label: "Upload image",
    description: "Analyze an image",
    icon: "Image",
    category: "Actions",
  },
  {
    id: "upload-document",
    label: "Upload document",
    description: "Process a document",
    icon: "Upload",
    category: "Actions",
  },
];

// ============================================
// REGISTER COMMANDS
// ============================================

// Store for navigation handler (set from React app)
let navigationHandler: ((path: string) => void) | null = null;
let chatHandler: ((message: string) => void) | null = null;

/**
 * Set the navigation handler (call from React app)
 */
export function setCommandNavigationHandler(handler: (path: string) => void): void {
  navigationHandler = handler;
}

/**
 * Set the chat handler (call from React app)
 */
export function setCommandChatHandler(handler: (message: string) => void): void {
  chatHandler = handler;
}

/**
 * Register all default commands
 */
export function registerDefaultCommands(): void {
  // Navigation commands
  navigationCommands.forEach((cmd) => {
    registerCommand({
      ...cmd,
      handler: () => {
        const pathMap: Record<string, string> = {
          "go-home": "/home",
          "go-chat": "/chat",
          "go-settings": "/settings",
          "go-developer": "/developer",
          "go-memory": "/memory-settings",
          "go-wisdom": "/wisdom",
        };
        if (navigationHandler && pathMap[cmd.id]) {
          navigationHandler(pathMap[cmd.id]);
        }
      },
    });
  });

  // Agent commands
  agentCommands.forEach((cmd) => {
    registerCommand({
      ...cmd,
      handler: () => {
        if (chatHandler) {
          const messageMap: Record<string, string> = {
            "analyze-finances": "Analyze my finances",
            "summarize-today": "Summarize today",
            "find-tasks": "Find my tasks",
            "draft-email": "Help me draft an email",
            "check-opportunities": "What opportunities do I have?",
            "pattern-analysis": "Analyze my patterns",
            "memory-recall": "What do you remember about...",
          };
          if (messageMap[cmd.id]) {
            chatHandler(messageMap[cmd.id]);
          }
        }
      },
    });
  });

  // Routine commands
  routineCommands.forEach((cmd) => {
    registerCommand({
      ...cmd,
      handler: () => {
        if (chatHandler) {
          const messageMap: Record<string, string> = {
            "morning-brief": "Give me my morning brief",
            "evening-review": "Let's do my evening review",
            "weekly-review": "Run my weekly review",
          };
          if (messageMap[cmd.id]) {
            chatHandler(messageMap[cmd.id]);
          }
        }
      },
    });
  });

  // Action commands
  actionCommands.forEach((cmd) => {
    registerCommand({
      ...cmd,
      handler: () => {
        console.log(`[Command] Action "${cmd.id}" triggered - STUB`);
        // STUB: Would trigger actual actions
      },
    });
  });

  console.log("[Commands] Default commands registered");
}

// Re-export utilities
export { getAllCommands, searchCommands };
