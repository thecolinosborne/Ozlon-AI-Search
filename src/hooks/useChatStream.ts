import { useState, useRef, useCallback } from "react";
import { streamChat, UserSettings, TaskUpdate } from "@/services/chatService";
import { useTaskActivityStore } from "@/stores/useTaskActivityStore";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

interface UseChatStreamOptions {
  messages: ChatMessage[];
  systemName: string;
  userSettings: UserSettings;
  autoPlayEnabled: boolean;
  saveMessage: (msg: { id: string; role: string; content: string }) => Promise<void>;
  updateMessageContent: (id: string, content: string) => void;
  finalizeMessage: (msg: { id: string; role: string; content: string }) => void;
  setSessionMessages: React.Dispatch<React.SetStateAction<any[]>>;
  playMessage: (id: string, text: string) => void;
}

export function useChatStream({
  messages,
  systemName,
  userSettings,
  autoPlayEnabled,
  saveMessage,
  updateMessageContent,
  finalizeMessage,
  setSessionMessages,
  playMessage,
}: UseChatStreamOptions) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const { addTask, updateStep, completeTask, setTaskSummary } = useTaskActivityStore();

  const abortStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
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

    setInput("");
    setIsLoading(true);

    // Persist user message with timeout guard
    await Promise.race([
      saveMessage(userMessage),
      new Promise<void>((resolve) => setTimeout(() => {
        console.warn("[sendMessage] saveMessage timed out after 10s, continuing...");
        resolve();
      }, 10_000)),
    ]);

    // Create assistant placeholder
    let assistantContent = "";
    const assistantId = crypto.randomUUID();

    setSessionMessages((prev: any[]) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() },
    ]);

    // Request-scoped state
    const requestTaskIds = new Set<string>();
    let outcome: "success" | "aborted" | "timeout" | "error" = "error";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortRef.current?.abort("timeout");
    }, 120_000);

    try {
      await streamChat({
        messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
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
          updateMessageContent(assistantId, assistantContent);
        },
        onTaskUpdate: (update: TaskUpdate) => {
          requestTaskIds.add(update.taskId);
          if (update.status === "in_progress") {
            const existing = useTaskActivityStore.getState().tasks.find((t) => t.id === update.taskId);
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

      // If streamChat resolved without calling onDone or onError (reader exhausted),
      // treat as success if we got content
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
        finalizeMessage({ id: assistantId, role: "assistant", content: assistantContent });
        requestTaskIds.forEach((id) => completeTask(id, "done"));
        if (autoPlayEnabled) playMessage(assistantId, assistantContent);
      } else if (outcome === "timeout") {
        updateMessageContent(assistantId, assistantContent || "Response timed out. Please try again.");
        requestTaskIds.forEach((id) => completeTask(id, "error"));
      } else if (outcome === "error") {
        updateMessageContent(assistantId, "Something went wrong. Please try again.");
        requestTaskIds.forEach((id) => completeTask(id, "error"));
      }
      // 'aborted' — intentional user cancel: no error message, no task mutation
    }
  }, [isLoading, messages, systemName, userSettings, autoPlayEnabled, saveMessage, updateMessageContent, finalizeMessage, setSessionMessages, playMessage, addTask, updateStep, completeTask, setTaskSummary]);

  return { input, setInput, isLoading, sendMessage, abortStream };
}
