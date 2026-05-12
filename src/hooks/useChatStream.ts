import { useState, useRef, useCallback, useEffect } from "react";
import { streamChat, UserSettings, TaskUpdate, ProviderUsedEvent, ToolUsedInfo, OrchestrationTraceEvent } from "@/services/chatService";
import { useTaskActivityStore } from "@/stores/useTaskActivityStore";

export type LiveStep = {
  label: string;
  status: "in_progress" | "done" | "error";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: ProviderUsedEvent;
  toolsUsed?: ToolUsedInfo[];
  orchestration?: OrchestrationTraceEvent;
  liveSteps?: LiveStep[];
  artifactId?: string;
  researchReportId?: string;
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
  sessionId?: string | null;
  saveMessage: (msg: { id: string; role: "user" | "assistant"; content: string; metadata?: Record<string, unknown> }) => Promise<void>;
  finalizeMessage: (msg: { id: string; role: "user" | "assistant"; content: string; metadata?: Record<string, unknown> }) => Promise<void> | void;
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
  sessionId,
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

  // Keep ephemeral chip metadata (provider/toolsUsed/orchestration/artifactId) alive
  // after a message is persisted, since persistence only stores {id, role, content}.
  const metadataOverlayRef = useRef<Map<string, Pick<ChatMessage, "provider" | "toolsUsed" | "orchestration" | "artifactId" | "researchReportId">>>(new Map());
  const [metadataOverlayVersion, setMetadataOverlayVersion] = useState(0);

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

      // ── Persist user message (fire-and-forget, don't block stream) ──
      saveMessage(userMessage).catch((err) => {
        if (isDev) console.warn("[useChatStream] saveMessage failed:", err);
      });

      if (!mountedRef.current) return;

      // ── Phase: streaming ─────────────────────────────────────────────
      transitionPhase("streaming");
      let assistantContent = "";
      let outcome: RequestOutcome = "pending";
      let timedOut = false;

      // 5-minute ceiling — research/tool loops can run 2–4 minutes.
      const timeoutId = setTimeout(() => {
        timedOut = true;
        abortRef.current?.abort("timeout");
      }, 300_000);

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
          sessionId: sessionId ?? undefined,
          assistantMessageId: assistantId,
          signal,
          onToolCall: (toolName, toolArgs) => {
            if (!isCurrentRequest()) return;
            if (isDev) console.log(`[useChatStream] Tool: ${toolName}`, toolArgs);
            const label = `Calling ${toolName}…`;
            safeSetInflight((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const steps = m.liveSteps ? [...m.liveSteps] : [];
                if (!steps.some((s) => s.label === label)) {
                  steps.push({ label, status: "in_progress" });
                }
                return { ...m, liveSteps: steps };
              })
            );
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

            const stepLabel = `${update.title}: ${update.step}`;
            safeSetInflight((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const steps = m.liveSteps ? [...m.liveSteps] : [];
                const idx = steps.findIndex((s) => s.label === stepLabel);
                const nextStatus: LiveStep["status"] =
                  update.status === "done"
                    ? "done"
                    : update.status === "error"
                    ? "error"
                    : "in_progress";
                if (idx >= 0) {
                  steps[idx] = { ...steps[idx], status: nextStatus };
                } else {
                  steps.push({ label: stepLabel, status: nextStatus });
                }
                return { ...m, liveSteps: steps };
              })
            );

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
          onProviderUsed: (info) => {
            if (!isCurrentRequest()) return;
            safeSetInflight((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, provider: info } : m
              )
            );
          },
          onToolsUsed: (info) => {
            if (!isCurrentRequest()) return;
            safeSetInflight((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, toolsUsed: info.tools } : m
              )
            );
          },
          onOrchestrationTrace: (trace) => {
            if (!isCurrentRequest()) return;
            safeSetInflight((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, orchestration: trace } : m
              )
            );
          },
          onInvestigationArtifact: (info) => {
            if (!isCurrentRequest()) return;
            safeSetInflight((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, artifactId: info.artifact_id } : m
              )
            );
          },
          onResearchArtifact: (info) => {
            if (!isCurrentRequest()) return;
            safeSetInflight((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, researchReportId: info.report_id } : m
              )
            );
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

        const resolvedOutcome: Exclude<RequestOutcome, "pending"> =
          outcome === "pending"
            ? signal.aborted
              ? timedOut
                ? "timeout"
                : "aborted"
              : "error"
            : outcome;

        transitionPhase(resolvedOutcome);
        safeSetIsLoading(false);

        const taskIds = requestTaskIdsRef.current;
        const currentInflight = inflightMessages;
        const inflightAssistant =
          currentInflight.find((m) => m.id === assistantId) ?? null;
        const finalAssistantMessage: ChatMessage | null = assistantContent
          ? {
              id: assistantId,
              role: "assistant",
              content: assistantContent,
              provider: inflightAssistant?.provider,
              toolsUsed: inflightAssistant?.toolsUsed,
              orchestration: inflightAssistant?.orchestration,
              artifactId: inflightAssistant?.artifactId,
            }
          : null;

        // Always transition to idle FIRST to unblock new messages,
        // then do async cleanup (persist, play, etc.) without blocking the phase.
        requestTaskIdsRef.current = new Set();
        transitionPhase("idle");

        if (resolvedOutcome === "success") {
          taskIds.forEach((id) => completeTask(id, "done"));

          if (finalAssistantMessage && autoPlayEnabled) {
            playMessage(assistantId, assistantContent);
          }

          // Stash chip metadata so it survives the inflight → persisted handoff.
          if (finalAssistantMessage) {
            const overlay = {
              provider: finalAssistantMessage.provider,
              toolsUsed: finalAssistantMessage.toolsUsed,
              orchestration: finalAssistantMessage.orchestration,
              artifactId: finalAssistantMessage.artifactId,
            };
            const hasAny = overlay.provider || (overlay.toolsUsed && overlay.toolsUsed.length > 0) || overlay.orchestration || overlay.artifactId;
            if (hasAny) {
              metadataOverlayRef.current.set(assistantId, overlay);
              setMetadataOverlayVersion((v) => v + 1);
            }

            // Pass artifactId through finalize/save metadata so it persists to DB
            const messageWithMetadata = {
              ...finalAssistantMessage,
              metadata: finalAssistantMessage.artifactId
                ? { artifact_id: finalAssistantMessage.artifactId }
                : undefined,
            };
            persistAssistantMessage(messageWithMetadata).catch((err) => {
              console.error("[useChatStream] Failed to persist assistant message:", err);
            });
          }

          if (isDev) {
            console.log(
              "[useChatStream] Success — deferring inflight cleanup to reconciliation effect."
            );
          }
        } else if (resolvedOutcome === "timeout") {
          safeSetInflight((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: assistantContent || "Response timed out. Please try again." }
                : m
            )
          );
          taskIds.forEach((id) => completeTask(id, "error"));
        } else if (resolvedOutcome === "error") {
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

  // Touch the version so consumers re-render when overlay updates.
  void metadataOverlayVersion;
  return {
    input,
    setInput,
    isLoading,
    inflightMessages,
    sendMessage,
    abortStream,
    metadataOverlay: metadataOverlayRef.current,
  };
}
