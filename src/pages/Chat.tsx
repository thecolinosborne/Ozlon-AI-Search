import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { QuickActions } from "@/components/chat/QuickActions";
import { AIOrb } from "@/components/AIOrb";
import { streamChat } from "@/services/chatService";
import { toast } from "sonner";
import type { Message } from "@/types";

const Chat = () => {
  const location = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    user,
    messages,
    addMessage,
    updateMessage,
    setLoading,
    isLoading,
    isOffline,
    addPendingMessage,
  } = useAppStore();

  const orbName = user?.orbName || "Orb";

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle initial intent from navigation
  useEffect(() => {
    const intent = location.state?.intent;
    if (intent) {
      handleQuickAction(intent);
      // Clear the state to prevent re-triggering
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Initialize with welcome message if empty
  useEffect(() => {
    if (messages.length === 0) {
      const welcomeMessage: Message = {
        id: "welcome",
        text: `${orbName} is active. What would you like to analyze?`,
        sender: "assistant",
        timestamp: new Date(),
        actions: ["Analyze today", "Request summary", "Check opportunities"],
      };
      addMessage(welcomeMessage);
    }
  }, []);

  const handleSendMessage = async (text: string) => {
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      text,
      sender: "user",
      timestamp: new Date(),
    };
    addMessage(userMessage);

    if (isOffline) {
      addPendingMessage(userMessage);
      toast.error("You are offline. Message queued.");
      return;
    }

    const assistantId = `assistant-${Date.now()}`;
    addMessage({
      id: assistantId,
      text: "",
      sender: "assistant",
      timestamp: new Date(),
      isLoading: true,
    });

    setLoading(true);

    // Build conversation history for Claude
    const chatHistory = messages
      .filter((m) => !m.isLoading && m.id !== "welcome")
      .map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.text,
      }))
      .concat([{ role: "user", content: text }]);

    let responseText = "";

    await streamChat({
      messages: chatHistory as { role: "user" | "assistant"; content: string }[],
      onDelta: (delta) => {
        responseText += delta;
        updateMessage(assistantId, {
          text: responseText,
          isLoading: false,
        });
      },
      onDone: () => {
        setLoading(false);
      },
      onError: (error) => {
        updateMessage(assistantId, {
          text: "Connection error. Please try again.",
          isLoading: false,
        });
        toast.error(error);
        setLoading(false);
      },
    });
  };

  const handleQuickAction = (intent: string) => {
    const actionText = intent.replace(/_/g, " ");
    handleSendMessage(actionText);
  };

  const handleRecordStart = () => {
    // TODO: Wire to Whisper/Deepgram - onRecordStart callback
    console.log("Recording started");
  };

  const handleRecordStop = () => {
    // TODO: Wire to Whisper/Deepgram - onRecordStop callback
    console.log("Recording stopped");
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-background to-muted/10">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-4 backdrop-blur-xl bg-background/80 border-b border-border/30 safe-area-top">
        <AIOrb breatheIn={!isLoading} />
        <div>
          <h1 className="text-lg font-semibold text-foreground">{orbName}</h1>
          <p className="text-xs text-muted-foreground">
            {isOffline ? "Offline mode" : "Active and observing"}
          </p>
        </div>
      </header>

      {/* Quick Actions - shown when no messages */}
      {messages.length <= 1 && <QuickActions onAction={handleQuickAction} />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onAction={handleQuickAction}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Offline Banner */}
      {isOffline && (
        <div className="px-4 py-2 bg-warning/10 border-t border-warning/30">
          <p className="text-xs text-warning text-center">
            You are offline. Messages will be sent when connection is restored.
          </p>
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSendMessage={handleSendMessage}
        onRecordStart={handleRecordStart}
        onRecordStop={handleRecordStop}
        disabled={isLoading}
      />

      {/* Bottom nav spacer */}
      <div className="h-16" />
    </div>
  );
};

export default Chat;
