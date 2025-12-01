import { useState } from "react";
import { VoiceButton } from "@/components/VoiceButton";
import { Input } from "@/components/ui/input";
import { api } from "@/services/api";
import { ActionButtons } from "@/components/ActionButtons";
import { QuickActionsBar } from "@/components/QuickActionsBar";
import { AIThinkingIndicator } from "@/components/AIThinkingIndicator";
import { AIOrb } from "@/components/AIOrb";

interface Message {
  id: string;
  text: string;
  sender: "user" | "assistant";
  actions?: string[];
}

const Chat = () => {
  const userName = localStorage.getItem("userName") || "there";
  const assistantName = localStorage.getItem("assistantName") || "Assistant";
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: `Hi ${userName}, I'm right here whenever you need me. What can I help you with today?`,
      sender: "assistant",
      actions: ["Tell me more", "Help with money", "Show my day"],
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: "user",
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    const response = await api.chat.send(input);

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: response.response,
      sender: "assistant",
      actions: ["Tell me more", "Do this", "Show options"],
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setLoading(false);
  };

  const handleAction = async (action: string) => {
    console.log("Action clicked:", action);
    // POST https://dummy.ozlon.ai/action
    setInput(action);
  };

  const handleQuickAction = async (intent: string) => {
    console.log("Quick action:", intent);
    // POST https://dummy.ozlon.ai/quick
    const actionText = intent.replace(/_/g, " ");
    setInput(actionText);
  };

  const handleVoiceInput = (text: string) => {
    setInput(text);
  };

  return (
    <div className="min-h-screen flex flex-col animate-gradient" style={{ 
      background: "linear-gradient(135deg, hsl(0 0% 100%) 0%, hsl(210 100% 98%) 30%, hsl(0 0% 98%) 70%, hsl(0 0% 96%) 100%)"
    }}>
      {/* Header */}
      <header className="backdrop-blur-sm bg-background/40 border-b border-border/20 px-6 py-8 animate-fade-in">
        <h1 className="text-4xl font-semibold text-foreground tracking-tight">{assistantName}</h1>
        <p className="text-sm text-muted-foreground/70 mt-2">
          Say "Hey {assistantName}..." anytime to talk to me.
        </p>
      </header>

      {/* Quick Actions Bar */}
      <div className="py-6 border-b border-border/20">
        <QuickActionsBar onAction={handleQuickAction} />
      </div>

      {/* Chat Feed */}
      <div className="flex-1 overflow-y-auto py-10 space-y-10">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === "user" ? "justify-end px-6" : "justify-start px-6"} ${
              message.sender === "user" ? "animate-slide-in-right" : "animate-slide-up-fade"
            }`}
          >
            {message.sender === "assistant" && (
              <div className="mr-5 mt-3">
                <AIOrb />
              </div>
            )}
            <div className="flex-1 max-w-3xl">
              <div
                className={`px-10 py-7 rounded-3xl ${
                  message.sender === "user"
                    ? "backdrop-blur-md border border-border/40 shadow-lg ml-auto max-w-[85%]"
                    : "bg-background/60 backdrop-blur-md border border-border/30 shadow-lg"
                }`}
                style={
                  message.sender === "assistant" 
                    ? { boxShadow: "var(--ai-message-glow)" } 
                    : { background: "var(--user-message-bg)", boxShadow: "0 8px 24px -8px hsl(0 0% 0% / 0.1)" }
                }
              >
                <p className="text-base leading-relaxed text-foreground/95">{message.text}</p>
              </div>
              {message.sender === "assistant" && message.actions && (
                <ActionButtons actions={message.actions} onAction={handleAction} />
              )}
            </div>
          </div>
        ))}
        {loading && <AIThinkingIndicator />}
      </div>

      {/* Input Area - Voice First */}
      <div className="backdrop-blur-md bg-background/50 border-t border-border/30 px-6 py-8">
        <div className="max-w-4xl mx-auto flex items-center gap-5">
          <Input
            type="text"
            placeholder="Or type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            className="flex-1 h-14 rounded-3xl bg-background/70 backdrop-blur-sm border-border/40 text-base px-6"
            disabled={loading}
          />
          <VoiceButton onVoiceInput={handleVoiceInput} className="flex-shrink-0" />
        </div>
      </div>
    </div>
  );
};

export default Chat;
