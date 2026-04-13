import { useState, useRef, useCallback } from "react";
import { streamChat, UserSettings, TaskUpdate } from "@/services/chatService";
import { useTaskActivityStore } from "@/stores/useTaskActivityStore";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

interface UseChatStreamOptions {
  /** Persisted messages — used to build the prompt context sent to the model. */
  persistedMessages: ChatMessage[];
  systemName: string;
  userSettings: UserSettings;
  autoPlayEnabled: boolean;
  saveMessage: (msg: { id: string; role: "user" | "assistant"; content: string }) => Promise<void>;
  finalizeMessage: (msg: { id: string; role: "user" | "assistant"; content: string }) => void;
  playMessage: (id: string, text: string) => void;
}

/**
 * Owns the full lifecycle of a chat request:
 *  – optimistic user message (inflight)
 *  – assistant placeholder (inflight)
 *  – streaming delta updates
 *  – finalization & reconciliation
 *
 * Exposes `inflightMessages` so the page can merge them with persisted
 * session messages to build a single `visibleMessages` array that never
 * drops content during async saves or session creation.
 */
export function useChatStream({
  persistedMessages,
  systemName,
  userSettings,
  autoPlayEnabled,
  saveMessage,
  finalizeMessage,
  playMessage,
}: UseChatStreamOptions) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Messages created during the current request that haven't been reconciled
   * with persisted state yet. Cleared once finalizeMessage succeeds.
   */
  const [inflightMessages, setInflightMessages] = useState<ChatMessage[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  const { addTask, updateStep, completeTask, setTaskSummary } = useTaskActivityStore();

  const abortStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setInflightMessages([]);
  }, []);

  const sendMessage = useCallback(async (text: string, intent?: string) => {
    if (!text.trim() || isLoading) return;

    // Abort any prior in-flight stream
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const assistantId = crypto.randomUUID();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    // ── Synchronous optimistic update ──────────────────────────────────
    // These state updates are batched by React and will render in the
    // same frame, so the UI transitions to conversation mode instantly.
    setInput("");
    setIsLoading(true);
    setInflightMessages([userMessage, assistantPlaceholder]);

    // ── Persist user message (fire-and-forget with timeout) ────────────
    // We don't await this before showing the message — it's already
    // visible via inflightMessages.
    const persistPromise = Promise.race([
      saveMessage(userMessage),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          console.warn("[sendMessage] saveMessage timed out after 10s, continuing...");
          resolve();
        }, 10_000)
      ),
    ]);

    // Wait for persistence before streaming so the session is ready,
    // but the UI is already showing messages.
    await persistPromise;

    // ── Stream the response ────────────────────────────────────────────
    let assistantContent = "";
    const requestTaskIds = new Set<string>();
    let outcome: "success" | "aborted" | "timeout" | "error" = "error";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortRef.current?.abort("timeout");
    }, 120_000);

    try {
      await streamChat({
        messages: [...persistedMessages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        })),
        intent,
        systemName,
        userSettings,
        enableTools: true,
        signal,
        onToolCall: (toolName, toolArgs) => {
          console.log(`Tool called: ${toolName}`, toolArgs);
        },
        onDelta: (delta) => {
          assistantContent += delta;
          // Update the assistant message in inflight state
          setInflightMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: assistantContent } : m
            )
          );
        },
        onTaskUpdate: (update: TaskUpdate) => {
          requestTaskIds.add(update.taskId);
          if (update.status === "in_progress") {
            const existing = useTaskActivityStore
              .getState()
              .tasks.find((t) => t.id === update.taskId);
            if (!existing) addTask(update.taskId, update.title);
            updateStep(update.taskId, update.step, "in_progress");
          } else if (update.status === "done") {
            updateStep(update.taskId, update.step, "done");
            if (update.summary) setTaskSummary(update.taskId, update.summary);
          } else if (update.status === "error") {
            updateStep(update.taskId, update.step, "error");
          }
        },
        onDone: () => {
          outcome = "success";
        },
        onError: (errorMsg: string) => {
          console.error("Chat stream service error:", errorMsg);
          outcome = "error";
        },
      });

      if (outcome !== "error") outcome = "success";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        outcome = timedOut ? "timeout" : "aborted";
      } else {
        console.error("Chat stream exception:", error);
        outcome = "error";
      }
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);

      if (outcome === "success" && assistantContent) {
        // Persist the assistant message, then clear inflight.
        // finalizeMessage will upsert into sessionMessages, so once it
        // runs the persisted list has both user + assistant messages.
        finalizeMessage({
          id: assistantId,
          role: "assistant",
          content: assistantContent,
        });
        requestTaskIds.forEach((id) => completeTask(id, "done"));
        if (autoPlayEnabled) playMessage(assistantId, assistantContent);
        // Clear inflight — persisted state now has everything
        setInflightMessages([]);
      } else if (outcome === "timeout") {
        setInflightMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    assistantContent || "Response timed out. Please try again.",
                }
              : m
          )
        );
        requestTaskIds.forEach((id) => completeTask(id, "error"));
      } else if (outcome === "error") {
        setInflightMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Something went wrong. Please try again." }
              : m
          )
        );
        requestTaskIds.forEach((id) => completeTask(id, "error"));
      } else {
        // aborted — clear inflight silently
        setInflightMessages([]);
      }
    }
  }, [
    isLoading,
    persistedMessages,
    systemName,
    userSettings,
    autoPlayEnabled,
    saveMessage,
    finalizeMessage,
    playMessage,
    addTask,
    updateStep,
    completeTask,
    setTaskSummary,
  ]);

  return { input, setInput, isLoading, inflightMessages, sendMessage, abortStream };
}
