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
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { addTask, updateStep, completeTask, setTaskSummary } = useTaskActivityStore();

  const abortStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const sendMessage = useCallback(async (text: string, intent?: string) => {
    if (!text.trim() || isLoading) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setInput("");
    setIsLoading(true);

    await Promise.race([
      saveMessage(userMessage),
      new Promise<void>((resolve) => setTimeout(() => {
        console.warn("[sendMessage] saveMessage timed out after 10s, continuing...");
        resolve();
      }, 10_000)),
    ]);

    let assistantContent = "";
    const assistantId = crypto.randomUUID();

    setSessionMessages((prev: any[]) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() },
    ]);

    safetyTimeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      if (!assistantContent) {
        updateMessageContent(assistantId, "Request timed out. Please try again.");
      }
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
          if (safetyTimeoutRef.current) {
            clearTimeout(safetyTimeoutRef.current);
            safetyTimeoutRef.current = null;
          }
          setIsLoading(false);
          const allTasks = useTaskActivityStore.getState().tasks.filter(
            (t) => t.status === "in_progress" || t.status === "error"
          );
          allTasks.forEach((t) => completeTask(t.id, "done"));

          if (assistantContent) {
            finalizeMessage({ id: assistantId, role: "assistant", content: assistantContent });
            if (autoPlayEnabled) playMessage(assistantId, assistantContent);
          }
        },
        onError: (errorMsg: string) => {
          if (safetyTimeoutRef.current) {
            clearTimeout(safetyTimeoutRef.current);
            safetyTimeoutRef.current = null;
          }
          console.error("Chat error:", errorMsg);
          updateMessageContent(assistantId, "Something went wrong. Please try again.");
          setIsLoading(false);
          const activeTasks = useTaskActivityStore.getState().tasks.filter((t) => t.status === "in_progress");
          activeTasks.forEach((t) => completeTask(t.id, "error"));
        },
      });
    } catch (error) {
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        console.log("Stream aborted");
      } else {
        console.error("Chat error:", error);
        updateMessageContent(assistantId, "Something went wrong. Please try again.");
      }
      setIsLoading(false);
    }
  }, [isLoading, messages, systemName, userSettings, autoPlayEnabled, saveMessage, updateMessageContent, finalizeMessage, setSessionMessages, playMessage, addTask, updateStep, completeTask, setTaskSummary]);

  return { input, setInput, isLoading, sendMessage, abortStream };
}
