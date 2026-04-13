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
 *
 * Task activity is scoped per-request: task IDs are tracked in a ref so
 * abort/new-request can reliably clean them up.
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
  const [inflightMessages, setInflightMessages] = useState<ChatMessage[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  /** Task IDs created during the current in-flight request. Persisted in a
   *  ref so `abortStream` can access them outside the `sendMessage` closure. */
  const requestTaskIdsRef = useRef<Set<string>>(new Set());

  const { addTask, updateStep, completeTask, setTaskSummary, failStaleTasks } =
    useTaskActivityStore();

  const abortStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setInflightMessages([]);

    // Fail any tasks that belonged to the aborted request
    if (requestTaskIdsRef.current.size > 0) {
      failStaleTasks(requestTaskIdsRef.current);
      requestTaskIdsRef.current = new Set();
    }
  }, [failStaleTasks]);

  const sendMessage = useCallback(
    async (text: string, intent?: string) => {
      if (!text.trim() || isLoading) return;

      // ── Clean up prior request ───────────────────────────────────────
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      // Fail any leftover in_progress tasks from a prior request
      if (requestTaskIdsRef.current.size > 0) {
        failStaleTasks(requestTaskIdsRef.current);
      }
      requestTaskIdsRef.current = new Set();

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

      // ── Synchronous optimistic update ────────────────────────────────
      setInput("");
      setIsLoading(true);
      setInflightMessages([userMessage, assistantPlaceholder]);

      // ── Persist user message (with timeout guard) ────────────────────
      await Promise.race([
        saveMessage(userMessage),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            console.warn(
              "[sendMessage] saveMessage timed out after 10s, continuing..."
            );
            resolve();
          }, 10_000)
        ),
      ]);

      // ── Stream the response ──────────────────────────────────────────
      let assistantContent = "";
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
            setInflightMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: assistantContent }
                  : m
              )
            );
          },
          onTaskUpdate: (update: TaskUpdate) => {
            // Track this task as belonging to the current request
            requestTaskIdsRef.current.add(update.taskId);

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

        const taskIds = requestTaskIdsRef.current;

        if (outcome === "success" && assistantContent) {
          finalizeMessage({
            id: assistantId,
            role: "assistant",
            content: assistantContent,
          });
          taskIds.forEach((id) => completeTask(id, "done"));
          if (autoPlayEnabled) playMessage(assistantId, assistantContent);
          setInflightMessages([]);
          requestTaskIdsRef.current = new Set();
        } else if (outcome === "timeout") {
          setInflightMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      assistantContent ||
                      "Response timed out. Please try again.",
                  }
                : m
            )
          );
          taskIds.forEach((id) => completeTask(id, "error"));
          requestTaskIdsRef.current = new Set();
        } else if (outcome === "error") {
          setInflightMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: "Something went wrong. Please try again.",
                  }
                : m
            )
          );
          taskIds.forEach((id) => completeTask(id, "error"));
          requestTaskIdsRef.current = new Set();
        } else {
          // aborted — clean up silently
          setInflightMessages([]);
          if (taskIds.size > 0) {
            failStaleTasks(taskIds);
          }
          requestTaskIdsRef.current = new Set();
        }
      }
    },
    [
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
      failStaleTasks,
    ]
  );

  return { input, setInput, isLoading, inflightMessages, sendMessage, abortStream };
}
