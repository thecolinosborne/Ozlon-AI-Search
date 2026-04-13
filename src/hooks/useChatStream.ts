import { useState, useRef, useCallback, useEffect } from "react";
import { streamChat, UserSettings, TaskUpdate } from "@/services/chatService";
import { useTaskActivityStore } from "@/stores/useTaskActivityStore";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/**
 * Explicit lifecycle phases for a single chat request.
 * Valid transitions:
 *   idle → optimistic → streaming → success | error | timeout | aborted → idle
 */
export type StreamPhase =
  | "idle"
  | "optimistic"
  | "streaming"
  | "success"
  | "error"
  | "timeout"
  | "aborted";

const VALID_TRANSITIONS: Record<StreamPhase, StreamPhase[]> = {
  idle: ["optimistic"],
  optimistic: ["streaming", "error", "aborted"],
  streaming: ["success", "error", "timeout", "aborted"],
  success: ["idle"],
  error: ["idle"],
  timeout: ["idle"],
  aborted: ["idle"],
};

const isDev = import.meta.env.DEV;

interface UseChatStreamOptions {
  persistedMessages: ChatMessage[];
  systemName: string;
  userSettings: UserSettings;
  autoPlayEnabled: boolean;
  saveMessage: (msg: { id: string; role: "user" | "assistant"; content: string }) => Promise<void>;
  finalizeMessage: (msg: { id: string; role: "user" | "assistant"; content: string }) => Promise<void> | void;
  playMessage: (id: string, text: string) => void;
}

type RequestOutcome =
  | "pending"
  | "success"
  | "error"
  | "timeout"
  | "aborted";

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
  const mountedRef = useRef(true);
  const phaseRef = useRef<StreamPhase>("idle");
  const persistedMessagesRef = useRef(persistedMessages);
  const requestTaskIdsRef = useRef<Set<string>>(new Set());
  const requestIdRef = useRef(0);

  const { addTask, updateStep, completeTask, setTaskSummary, failStaleTasks } =
    useTaskActivityStore();

  // ── Phase transition with validation ─────────────────────────────────
  const transitionPhase = useCallback((next: StreamPhase) => {
    const current = phaseRef.current;
    if (isDev && !VALID_TRANSITIONS[current]?.includes(next)) {
      console.warn(
        `[useChatStream] Invalid phase transition: ${current} → ${next}. Allowing but this may indicate a bug.`
      );
    }
    phaseRef.current = next;
  }, []);

  // ── Safe state setters (skip if unmounted) ───────────────────────────
  const safeSetIsLoading = useCallback((v: boolean) => {
    if (mountedRef.current) setIsLoading(v);
  }, []);
  const safeSetInflight = useCallback((v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    if (mountedRef.current) setInflightMessages(v);
  }, []);

  const isPersistedMessage = useCallback((message: ChatMessage) => {
    return persistedMessagesRef.current.some(
      (persisted) =>
        persisted.id === message.id &&
        persisted.role === message.role &&
        persisted.content === message.content
    );
  }, []);

  const persistAssistantMessage = useCallback(
    async (message: ChatMessage) => {
      const alreadyExists = persistedMessagesRef.current.some(
        (persisted) => persisted.id === message.id
      );

      if (alreadyExists) {
        await Promise.resolve(finalizeMessage(message));
        return;
      }

      await saveMessage(message);
    },
    [finalizeMessage, saveMessage]
  );

  const abortStream = useCallback(() => {
    if (!abortRef.current) return;

    abortRef.current.abort();
    abortRef.current = null;
    safeSetIsLoading(false);
  }, [safeSetIsLoading]);

  useEffect(() => {
    persistedMessagesRef.current = persistedMessages;
  }, [persistedMessages]);

  useEffect(() => {
    if (!mountedRef.current || inflightMessages.length === 0) return;
    if (phaseRef.current !== "idle") return;

    const allReconciled = inflightMessages.every(isPersistedMessage);
    if (!allReconciled) return;

    safeSetInflight((prev) => (prev.every(isPersistedMessage) ? [] : prev));
  }, [inflightMessages, isPersistedMessage, persistedMessages, safeSetInflight]);

  const sendMessage = useCallback(
    async (text: string, intent?: string) => {
      if (!text.trim() || isLoading) return;

      if (isDev && phaseRef.current !== "idle") {
        console.warn(
          `[useChatStream] sendMessage called during phase "${phaseRef.current}" — forcing reset.`
        );
      }

      // ── Clean up prior request ───────────────────────────────────────
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      const isCurrentRequest = () => requestIdRef.current === requestId;

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

      // ── Phase: optimistic ────────────────────────────────────────────
      transitionPhase("optimistic");
      setInput("");
      safeSetIsLoading(true);
      safeSetInflight([userMessage, assistantPlaceholder]);

      // ── Persist user message (with timeout guard) ────────────────────
      await Promise.race([
        saveMessage(userMessage),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            if (isDev) console.warn("[useChatStream] saveMessage timed out after 10s");
            resolve();
          }, 10_000)
        ),
      ]);

      if (!mountedRef.current) return;

      // ── Phase: streaming ─────────────────────────────────────────────
      transitionPhase("streaming");
      let assistantContent = "";
      let outcome: RequestOutcome = "pending";
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
            if (!isCurrentRequest()) return;
            if (isDev) console.log(`[useChatStream] Tool: ${toolName}`, toolArgs);
          },
          onDelta: (delta) => {
            if (!isCurrentRequest()) return;
            assistantContent += delta;
            safeSetInflight((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: assistantContent }
                  : m
              )
            );
          },
          onTaskUpdate: (update: TaskUpdate) => {
            if (!isCurrentRequest()) return;
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
            if (!isCurrentRequest()) return;
            outcome = "success";
          },
          onError: (errorMsg: string) => {
            if (!isCurrentRequest()) return;

            if (signal.aborted || /abort/i.test(errorMsg)) {
              outcome = timedOut ? "timeout" : "aborted";
              return;
            }

            console.error("[useChatStream] Stream error:", errorMsg);
            outcome = "error";
          },
        });

        if (outcome === "pending") {
          outcome = signal.aborted ? (timedOut ? "timeout" : "aborted") : "success";
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          outcome = timedOut ? "timeout" : "aborted";
        } else {
          console.error("[useChatStream] Stream exception:", error);
          outcome = "error";
        }
      } finally {
        clearTimeout(timeoutId);

        if (!mountedRef.current || !isCurrentRequest()) {
          return;
        }

        transitionPhase(outcome);
        safeSetIsLoading(false);

        const taskIds = requestTaskIdsRef.current;
        const finalAssistantMessage: ChatMessage | null = assistantContent
          ? {
              id: assistantId,
              role: "assistant",
              content: assistantContent,
            }
          : null;

        if (outcome === "success") {
          if (finalAssistantMessage) {
            await persistAssistantMessage(finalAssistantMessage);
          }

          taskIds.forEach((id) => completeTask(id, "done"));

          if (finalAssistantMessage && autoPlayEnabled) {
            playMessage(assistantId, assistantContent);
          }

          if (finalAssistantMessage) {
            if (isPersistedMessage(userMessage) && isPersistedMessage(finalAssistantMessage)) {
              safeSetInflight([]);
            } else if (isDev) {
              console.warn(
                "[useChatStream] Retaining inflight messages until persisted state catches up."
              );
            }
          } else if (isPersistedMessage(userMessage)) {
            safeSetInflight([]);
          } else {
            safeSetInflight((prev) => prev.filter((m) => m.id === userMessage.id));
          }
        } else if (outcome === "timeout") {
          safeSetInflight((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: assistantContent || "Response timed out. Please try again." }
                : m
            )
          );
          taskIds.forEach((id) => completeTask(id, "error"));
        } else if (outcome === "error") {
          safeSetInflight((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "Something went wrong. Please try again." }
                : m
            )
          );
          taskIds.forEach((id) => completeTask(id, "error"));
        } else {
          safeSetInflight((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: assistantContent || "Response stopped." }
                : m
            )
          );
          if (taskIds.size > 0) failStaleTasks(taskIds);
        }

        requestTaskIdsRef.current = new Set();
        transitionPhase("idle");
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
      persistAssistantMessage,
      isPersistedMessage,
      addTask,
      updateStep,
      completeTask,
      setTaskSummary,
      failStaleTasks,
      transitionPhase,
      safeSetIsLoading,
      safeSetInflight,
    ]
  );

  // ── Lifecycle: track mounted state, clean up on unmount ──────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      if (requestTaskIdsRef.current.size > 0) {
        failStaleTasks(requestTaskIdsRef.current);
        requestTaskIdsRef.current = new Set();
      }
    };
  }, [failStaleTasks]);

  return { input, setInput, isLoading, inflightMessages, sendMessage, abortStream };
}
