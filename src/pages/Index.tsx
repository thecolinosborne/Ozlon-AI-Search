import { useState, useRef, useEffect } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { streamChat } from "@/services/chatService";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const QUICK_ACTIONS = [
  { label: "Check Money", intent: "CHECK_MONEY", message: "Check my financial situation and balances." },
  { label: "Check Mail", intent: "CHECK_MAIL", message: "Check my email and summarize anything important." },
  { label: "Daily Digest", intent: "DAILY_DIGEST", message: "Give me a daily digest of my schedule, tasks, and priorities." },
  { label: "Analyze My Day", intent: "ANALYZE_DAY", message: "Analyze my day and suggest what I should focus on next." },
];

const Index = () => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string, intent?: string) => {
    if (!text.trim() || isLoading) return;

    setHasInteracted(true);
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    let assistantContent = "";
    const assistantId = crypto.randomUUID();

    // Add empty assistant message that we'll update
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      await streamChat({
        messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
        intent,
        onDelta: (delta) => {
          assistantContent += delta;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: assistantContent } : m))
          );
        },
        onDone: () => {
          setIsLoading(false);
        },
        onError: (error) => {
          console.error("Chat error:", error);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "Something went wrong. Please try again." }
                : m
            )
          );
          setIsLoading(false);
        },
      });
    } catch (error) {
      console.error("Chat error:", error);
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleQuickAction = (action: (typeof QUICK_ACTIONS)[0]) => {
    sendMessage(action.message, action.intent);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Hero Section - Always visible but shrinks after interaction */}
      <div
        className={cn(
          "flex flex-col items-center justify-center transition-all duration-500",
          hasInteracted ? "pt-8 pb-4" : "flex-1 min-h-[60vh]"
        )}
      >
        {/* Logo */}
        <h1
          className={cn(
            "font-light tracking-tight text-neutral-800 transition-all duration-500",
            hasInteracted ? "text-3xl mb-1" : "text-6xl md:text-7xl mb-2"
          )}
        >
          Ozlon
        </h1>
        <p
          className={cn(
            "text-neutral-500 transition-all duration-500",
            hasInteracted ? "text-xs mb-4" : "text-base md:text-lg mb-8"
          )}
        >
          Your Personal Operating System
        </p>

        {/* Search Input */}
        <form
          onSubmit={handleSubmit}
          className={cn(
            "w-full max-w-2xl px-4 transition-all duration-500",
            hasInteracted ? "max-w-xl" : ""
          )}
        >
          <div className="relative group">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Ozlon anything..."
              disabled={isLoading}
              className={cn(
                "w-full px-6 py-4 text-base rounded-full",
                "border border-neutral-200 shadow-sm",
                "focus:outline-none focus:border-neutral-300 focus:shadow-md",
                "transition-all duration-200",
                "placeholder:text-neutral-400",
                "disabled:opacity-50"
              )}
            />
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              <Mic className="w-5 h-5" />
            </button>
          </div>
        </form>

        {/* Quick Actions - Only show before interaction */}
        {!hasInteracted && (
          <div className="flex flex-wrap justify-center gap-2 mt-6 px-4">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.intent}
                onClick={() => handleQuickAction(action)}
                disabled={isLoading}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium rounded-full",
                  "bg-neutral-100 text-neutral-700",
                  "hover:bg-neutral-200 hover:shadow-sm",
                  "transition-all duration-200",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chat Messages - Show after interaction */}
      {hasInteracted && (
        <div className="flex-1 overflow-y-auto px-4 pb-32">
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
                    message.role === "user"
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-100 text-neutral-800"
                  )}
                >
                  {message.role === "assistant" ? (
                    <div className="prose prose-sm prose-neutral max-w-none">
                      {message.content || (
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-pulse" />
                          <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-pulse delay-75" />
                          <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-pulse delay-150" />
                        </span>
                      )}
                    </div>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Floating Quick Actions - Show after interaction */}
      {hasInteracted && (
        <div className="fixed bottom-24 left-0 right-0 px-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.intent}
                  onClick={() => handleQuickAction(action)}
                  disabled={isLoading}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap",
                    "bg-white border border-neutral-200 text-neutral-600",
                    "hover:bg-neutral-50 hover:border-neutral-300",
                    "transition-all duration-200",
                    "disabled:opacity-50"
                  )}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fixed Input at Bottom - Show after interaction */}
      {hasInteracted && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 p-4">
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Ozlon anything..."
                disabled={isLoading}
                className={cn(
                  "w-full px-5 py-3 text-sm rounded-full",
                  "border border-neutral-200 shadow-sm",
                  "focus:outline-none focus:border-neutral-300 focus:shadow-md",
                  "transition-all duration-200",
                  "placeholder:text-neutral-400",
                  "disabled:opacity-50"
                )}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Index;
