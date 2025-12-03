import { useState, useRef, useEffect } from "react";
import { Mic, Square, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { streamChat, UserSettings } from "@/services/chatService";
import { localDb, LocalMessage } from "@/services/localDb";
import { UserMenu } from "@/components/UserMenu";
import { SystemNamingModal } from "@/components/SystemNamingModal";
import { useSystemName } from "@/hooks/useSystemName";
import { useAppStore } from "@/stores/useAppStore";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

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
  const { systemName, user, needsOnboarding, isReturningUser, completeOnboarding } = useSystemName();
  const { user: storeUser, connections, agents } = useAppStore();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [welcomeShown, setWelcomeShown] = useState(false);
  
  // Build user settings for AI context
  const userSettings: UserSettings = {
    communicationMode: storeUser?.communicationMode || 'both',
    integrations: {
      calendar: connections.find(c => c.id === 'calendar')?.connected || false,
      email: connections.find(c => c.id === 'email')?.connected || false,
      banking: connections.find(c => c.id === 'banking')?.connected || false,
    },
    agents: {
      memory: agents.find(a => a.id === 'memory')?.enabled || false,
      orchestration: agents.find(a => a.id === 'orchestration')?.enabled || false,
      communication: agents.find(a => a.id === 'communication')?.enabled || false,
      personality: agents.find(a => a.id === 'personality')?.enabled || false,
      banking: agents.find(a => a.id === 'banking')?.enabled || false,
      summary: agents.find(a => a.id === 'summary')?.enabled || false,
    },
    osName: systemName,
  };
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load cached messages on mount
  useEffect(() => {
    const loadCachedMessages = async () => {
      try {
        const cached = await localDb.getMessages(100);
        if (cached.length > 0) {
          const msgs: Message[] = cached.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }));
          setMessages(msgs);
          setHasInteracted(true);
          console.log(`Loaded ${cached.length} cached messages`);
        }
      } catch (error) {
        console.error('Failed to load cached messages:', error);
      }
    };
    loadCachedMessages();
  }, []);

  // Show welcome back message for returning users (only if no cached messages)
  useEffect(() => {
    if (isReturningUser && !welcomeShown && messages.length === 0) {
      setWelcomeShown(true);
      const welcomeMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Welcome back! ${systemName} is ready to help. What would you like to do today?`,
      };
      setMessages([welcomeMessage]);
      setHasInteracted(true);
    }
  }, [isReturningUser, welcomeShown, systemName, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Helper to save message to local DB
  const saveMessageToCache = async (msg: Message) => {
    try {
      await localDb.saveMessage({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: Date.now(),
        synced: true,
      });
    } catch (error) {
      console.error('Failed to cache message:', error);
    }
  };

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

    // Cache user message
    saveMessageToCache(userMessage);

    let assistantContent = "";
    const assistantId = crypto.randomUUID();

    // Add empty assistant message that we'll update
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      await streamChat({
        messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
        intent,
        systemName,
        userSettings,
        onDelta: (delta) => {
          assistantContent += delta;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: assistantContent } : m))
          );
        },
        onDone: () => {
          setIsLoading(false);
          // Cache assistant response when complete
          if (assistantContent) {
            saveMessageToCache({ id: assistantId, role: "assistant", content: assistantContent });
          }
        },
        onError: (errorMsg: string) => {
          console.error("Chat error:", errorMsg);
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

  // Voice recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        if (chunksRef.current.length === 0) {
          toast.error("No audio recorded");
          return;
        }

        setIsTranscribing(true);
        
        try {
          const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const base64Audio = await blobToBase64(audioBlob);
          
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              },
              body: JSON.stringify({ audio: base64Audio }),
            }
          );

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Transcription failed');
          }

          const { text } = await response.json();
          
          if (text && text.trim()) {
            // Send the transcribed text as a message
            sendMessage(text.trim());
          } else {
            toast.error("I couldn't understand that clearly, can you please try again?");
          }
        } catch (error) {
          console.error('Transcription error:', error);
          toast.error("I couldn't understand that clearly, can you please try again?");
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Microphone access error:', error);
      toast.error("Could not access microphone");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleMicClick = () => {
    if (isTranscribing) return;
    
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleQuickAction = (action: (typeof QUICK_ACTIONS)[0]) => {
    sendMessage(action.message, action.intent);
  };

  // Mic button component for consistency
  const MicButton = ({ size = "normal" }: { size?: "normal" | "small" }) => {
    const isSmall = size === "small";
    const isProcessing = isTranscribing;
    
    return (
      <button
        type="button"
        onClick={handleMicClick}
        disabled={isProcessing || isLoading}
        className={cn(
          "relative rounded-full flex items-center justify-center transition-all duration-300",
          isSmall ? "w-8 h-8" : "p-2",
          isRecording 
            ? "bg-red-500 text-white" 
            : "text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100",
          isProcessing && "opacity-50 cursor-not-allowed",
          // Flashing animation when recording
          isRecording && "animate-pulse"
        )}
      >
        {isProcessing ? (
          <div className={cn(
            "border-2 border-current border-t-transparent rounded-full animate-spin",
            isSmall ? "w-3 h-3" : "w-4 h-4"
          )} />
        ) : isRecording ? (
          <Square className={cn(isSmall ? "w-3 h-3" : "w-4 h-4", "fill-current")} />
        ) : (
          <Mic className={cn(isSmall ? "w-4 h-4" : "w-5 h-5")} />
        )}
        {/* Pulsing ring when recording */}
        {isRecording && (
          <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 px-4 py-4 z-50">
        <div className="max-w-6xl mx-auto flex justify-end">
          <UserMenu />
        </div>
      </header>

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
          {systemName}
        </h1>
        <p
          className={cn(
            "text-neutral-500 transition-all duration-500",
            hasInteracted ? "text-xs mb-4" : "text-base md:text-lg mb-8"
          )}
        >
          Your Personal Operating System
        </p>

        {/* Search Input - Only show before interaction */}
        {!hasInteracted && (
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-2xl px-4"
          >
            <div className="relative group">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Ask ${systemName} anything...`}
                disabled={isLoading || isRecording}
                className={cn(
                  "w-full px-6 py-4 text-base rounded-full",
                  "border border-neutral-200 shadow-sm",
                  "focus:outline-none focus:border-neutral-300 focus:shadow-md",
                  "transition-all duration-200",
                  "placeholder:text-neutral-400",
                  "disabled:opacity-50"
                )}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {input.trim() && (
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="p-2 text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
                <MicButton />
              </div>
            </div>
          </form>
        )}

        {/* Quick Actions - Only show before interaction */}
        {!hasInteracted && (
          <div className="flex flex-wrap justify-center gap-2 mt-6 px-4">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.intent}
                onClick={() => handleQuickAction(action)}
                disabled={isLoading || isRecording}
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
                    <div className="prose prose-sm prose-neutral max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-headings:font-semibold prose-p:my-1 prose-ul:my-2 prose-li:my-0.5">
                      {message.content ? (
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      ) : (
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
                  disabled={isLoading || isRecording}
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
                placeholder={isRecording ? "Recording..." : `Ask ${systemName} anything...`}
                disabled={isLoading || isRecording}
                className={cn(
                  "w-full px-5 py-3 pr-20 text-sm rounded-full",
                  "border border-neutral-200 shadow-sm",
                  "focus:outline-none focus:border-neutral-300 focus:shadow-md",
                  "transition-all duration-200",
                  "placeholder:text-neutral-400",
                  "disabled:opacity-50",
                  isRecording && "border-red-300 bg-red-50/30"
                )}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {input.trim() && !isRecording && (
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
                <MicButton size="small" />
              </div>
            </div>
          </form>
        </div>
      )}

      {/* System Naming Modal - Onboarding */}
      {user && needsOnboarding && (
        <SystemNamingModal
          isOpen={needsOnboarding}
          onComplete={completeOnboarding}
          userId={user.id}
        />
      )}
    </div>
  );
};

// Helper function
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default Index;
