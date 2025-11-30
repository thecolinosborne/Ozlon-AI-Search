import { useState } from "react";
import { VoiceButton } from "@/components/VoiceButton";
import { Input } from "@/components/ui/input";
import { api } from "@/services/api";

interface Message {
  id: string;
  text: string;
  sender: "user" | "assistant";
}

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "How can I help you today?",
      sender: "assistant",
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
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setLoading(false);
  };

  const handleVoiceInput = (text: string) => {
    setInput(text);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-medium text-foreground">Ozlon</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"} animate-slide-up`}
          >
            <div
              className={`max-w-[80%] px-6 py-4 rounded-3xl ${
                message.sender === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground"
              }`}
            >
              <p className="text-base leading-relaxed">{message.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start animate-slide-up">
            <div className="bg-secondary px-6 py-4 rounded-3xl">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse-soft" />
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse-soft" style={{ animationDelay: "0.2s" }} />
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse-soft" style={{ animationDelay: "0.4s" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border px-6 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <Input
            type="text"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            className="flex-1 h-12 rounded-2xl"
            disabled={loading}
          />
          <VoiceButton onVoiceInput={handleVoiceInput} className="flex-shrink-0" />
        </div>
      </div>
    </div>
  );
};

export default Chat;
