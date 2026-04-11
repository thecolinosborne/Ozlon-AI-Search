import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, Square, Send, Volume2, VolumeX, Loader2, Phone, Paperclip, X, FileText, Image as ImageIcon, MessageSquare, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { streamChat, UserSettings, TaskUpdate } from "@/services/chatService";
import { useTaskActivityStore } from "@/stores/useTaskActivityStore";
import { UserMenu } from "@/components/UserMenu";
import { SystemNamingModal } from "@/components/SystemNamingModal";
import { useAuth } from "@/contexts/AuthContext";
import { useAppStore } from "@/stores/useAppStore";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { voiceService } from "@/services/voiceService";
import { supabase } from "@/integrations/supabase/client";
import { RealtimeVoiceChat } from "@/components/RealtimeVoiceChat";
import { TaskActivityBubble } from "@/components/TaskActivityBubble";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { useConversations } from "@/hooks/useConversations";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const QUICK_ACTIONS = [
  { label: "Check Money", intent: "CHECK_MONEY", message: "Check my financial situation and balances.", integration: "banking" as const },
  { label: "Check Mail", intent: "CHECK_MAIL", message: "Check my email and summarize anything important.", integration: "email" as const },
  { label: "Daily Digest", intent: "DAILY_DIGEST", message: "Give me a daily digest of my schedule, tasks, and priorities.", integration: "calendar" as const },
];

type QuickAction = typeof QUICK_ACTIONS[number];

const Index = () => {
  const navigate = useNavigate();
  const { authLoading, session, user, systemName, needsOnboarding, profileLoaded, isReturningUser, completeOnboarding, voiceEnabled } = useAuth();
  const isAuthenticated = !!session && !!user;
  const { user: storeUser, connections, agents } = useAppStore();
  const { addTask, updateStep, completeTask, setTaskSummary } = useTaskActivityStore();

  // Conversation session management
  const {
    sessions,
    activeSessionId,
    messages: sessionMessages,
    setMessages: setSessionMessages,
    sessionsLoaded,
    switchSession,
    startNewChat,
    saveMessage,
    updateMessageContent,
    finalizeMessage,
    deleteSession,
  } = useConversations();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Redirect to onboarding if needed
  useEffect(() => {
    if (!authLoading && profileLoaded && isAuthenticated && needsOnboarding) {
      navigate("/onboarding");
    }
  }, [authLoading, profileLoaded, isAuthenticated, needsOnboarding, navigate]);

  const [input, setInput] = useState("");
  // Convert session messages to local Message type
  const messages: Message[] = sessionMessages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
  }));
  const [isLoading, setIsLoading] = useState(false);
  const hasInteracted = messages.length > 0;
  const [welcomeShown, setWelcomeShown] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);

  // File upload state
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mode toggle state: 'chat' or 'voice'
  const [activeMode, setActiveMode] = useState<'chat' | 'voice'>('chat');

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

  // Load auto-play setting
  useEffect(() => {
    const loadAutoPlaySetting = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { settings } = await voiceService.getSettings();
          setAutoPlayEnabled(settings?.auto_play_responses ?? false);
        }
      } catch (error) {
        console.error('Failed to load auto-play setting:', error);
      }
    };
    loadAutoPlaySetting();
  }, []);

  // Show welcome back message for returning users (only if no messages in current session)
  useEffect(() => {
    if (isReturningUser && !welcomeShown && messages.length === 0 && sessionsLoaded && activeSessionId) {
      setWelcomeShown(true);
      const welcomeId = crypto.randomUUID();
      const welcomeMsg = {
        id: welcomeId,
        role: "assistant" as const,
        content: `Welcome back! ${systemName} is ready to help. What would you like to do today?`,
      };
      // Add locally (don't persist welcome messages)
      setSessionMessages((prev) => [...prev, { ...welcomeMsg, created_at: new Date().toISOString() }]);
    }
  }, [isReturningUser, welcomeShown, systemName, messages.length, sessionsLoaded, activeSessionId, setSessionMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string, intent?: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    // Save user message to session
    await saveMessage(userMessage);
    await finalizeMessage(userMessage);

    setInput("");
    setIsLoading(true);

    let assistantContent = "";
    const assistantId = crypto.randomUUID();

    // Add empty assistant placeholder
    setSessionMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() }]);

    try {
      await streamChat({
        messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
        intent,
        systemName,
        userSettings,
        enableTools: true,
        onToolCall: (toolName, toolArgs) => {
          console.log(`Tool called: ${toolName}`, toolArgs);
        },
        onDelta: (delta) => {
          assistantContent += delta;
          updateMessageContent(assistantId, assistantContent);
        },
        onTaskUpdate: (update: TaskUpdate) => {
          if (update.status === 'in_progress') {
            const existing = useTaskActivityStore.getState().tasks.find(t => t.id === update.taskId);
            if (!existing) {
              addTask(update.taskId, update.title);
            }
            updateStep(update.taskId, update.step, 'in_progress');
          } else if (update.status === 'done') {
            updateStep(update.taskId, update.step, 'done');
            if (update.summary) {
              setTaskSummary(update.taskId, update.summary);
            }
          } else if (update.status === 'error') {
            updateStep(update.taskId, update.step, 'error');
            completeTask(update.taskId, 'error');
          }
        },
        onDone: () => {
          setIsLoading(false);
          const activeTasks = useTaskActivityStore.getState().tasks.filter(t => t.status === 'in_progress');
          activeTasks.forEach(t => completeTask(t.id, 'done'));

          if (assistantContent) {
            finalizeMessage({ id: assistantId, role: "assistant", content: assistantContent });

            if (autoPlayEnabled) {
              playMessage(assistantId, assistantContent);
            }
          }
        },
        onError: (errorMsg: string) => {
          console.error("Chat error:", errorMsg);
          updateMessageContent(assistantId, "Something went wrong. Please try again.");
          setIsLoading(false);
        },
      });
    } catch (error) {
      console.error("Chat error:", error);
      setIsLoading(false);
    }
  };

  // Play message audio
  const playMessage = async (messageId: string, text: string) => {
    if (playingMessageId === messageId) {
      voiceService.stop();
      setPlayingMessageId(null);
      return;
    }

    setLoadingAudioId(messageId);
    try {
      setPlayingMessageId(messageId);
      await voiceService.speak(text);
    } catch (error) {
      console.error('Playback error:', error);
      toast.error("Could not play voice");
    } finally {
      setPlayingMessageId(null);
      setLoadingAudioId(null);
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
            setInput(text.trim());
            toast.success("Voice transcribed - review and send when ready");
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

  const handleQuickAction = (action: QuickAction) => {
    sendMessage(action.message, action.intent);
  };

  // File upload handlers
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(file => {
      const maxSize = 20 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error(`${file.name} is too large (max 20MB)`);
        return false;
      }
      return true;
    });

    if (attachedFiles.length + validFiles.length > 10) {
      toast.error("Maximum 10 files per message");
      return;
    }

    setAttachedFiles(prev => [...prev, ...validFiles]);
    e.target.value = '';
  }, [attachedFiles.length]);

  const removeFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const triggerFileUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <ImageIcon className="w-4 h-4" />;
    }
    return <FileText className="w-4 h-4" />;
  };

  // Mic button component
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
        {isRecording && (
          <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Conversation Sidebar */}
      <ConversationSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={async () => {
          await startNewChat();
          setWelcomeShown(false);
        }}
        onSelectSession={switchSession}
        onDeleteSession={deleteSession}
      />

      {/* Global File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.webp"
        onChange={handleFileSelect}
        className="hidden"
        aria-hidden="true"
      />

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 px-4 py-4 z-[60] bg-white/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            {/* Sidebar toggle */}
            {isAuthenticated && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-neutral-100 transition-colors"
                title="Conversations"
              >
                <Menu className="w-5 h-5 text-neutral-600" />
              </button>
            )}

            {/* Chat/Voice Toggle */}
            <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-full">
              <button
                type="button"
                onClick={() => setActiveMode('chat')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-all",
                  activeMode === 'chat'
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                <MessageSquare className="w-4 h-4" />
                Chat
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isAuthenticated) {
                    toast.error("Sign in to use voice conversation");
                    return;
                  }
                  if (!voiceEnabled) {
                    toast.error("Enable voice conversation in Settings first");
                    return;
                  }
                  setActiveMode('voice');
                }}
                disabled={!isAuthenticated}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-all",
                  activeMode === 'voice'
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700",
                  !isAuthenticated && "opacity-50 cursor-not-allowed"
                )}
                title={!isAuthenticated ? "Sign in to enable voice" : !voiceEnabled ? "Enable in Settings" : "Voice conversation"}
              >
                <Phone className="w-4 h-4" />
                Voice
              </button>
            </div>
          </div>
          <UserMenu />
        </div>
      </header>

      {/* Voice Mode - Full Screen Realtime Chat */}
      {activeMode === 'voice' && isAuthenticated && voiceEnabled && (
        <RealtimeVoiceChat
          systemName={systemName}
          onClose={() => setActiveMode('chat')}
        />
      )}

      {/* Voice Mode Blocked Message */}
      {activeMode === 'voice' && (!isAuthenticated || !voiceEnabled) && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
          <button
            onClick={() => setActiveMode('chat')}
            className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors text-sm"
          >
            Close
          </button>

          <div className="w-24 h-24 rounded-full bg-neutral-700 flex items-center justify-center mb-8">
            <Phone className="w-10 h-10 text-neutral-400" />
          </div>

          <h2 className="text-white text-2xl font-light mb-4">Voice Conversation</h2>

          {!isAuthenticated ? (
            <>
              <p className="text-neutral-400 text-center mb-6 max-w-sm">
                Sign in to enable voice conversation with {systemName}.
              </p>
              <a
                href="/auth"
                className="px-6 py-3 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 transition-colors"
              >
                Sign in
              </a>
            </>
          ) : (
            <>
              <p className="text-neutral-400 text-center mb-6 max-w-sm">
                Turn on Voice Mode in Settings to use voice conversation.
              </p>
              <a
                href="/settings"
                className="px-6 py-3 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 transition-colors"
              >
                Go to Settings
              </a>
            </>
          )}
        </div>
      )}

      {/* Chat Mode Content */}
      {activeMode === 'chat' && (
        <>
          {/* Hero Section */}
          <div
            className={cn(
              "flex flex-col items-center justify-center transition-all duration-500",
              hasInteracted ? "pt-16 pb-4" : "flex-1 min-h-[60vh]"
            )}
          >
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
              <form onSubmit={handleSubmit} className="w-full max-w-2xl px-4">
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3 px-2">
                    {attachedFiles.map((file, index) => (
                      <div key={index} className="flex items-center gap-2 px-3 py-1.5 bg-neutral-100 rounded-full text-sm">
                        {getFileIcon(file)}
                        <span className="max-w-[150px] truncate">{file.name}</span>
                        <button type="button" onClick={() => removeFile(index)} className="text-neutral-400 hover:text-neutral-600">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="relative group">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={`Ask ${systemName} anything...`}
                    disabled={isLoading || isRecording}
                    className={cn(
                      "w-full px-6 py-4 pl-14 text-base rounded-full",
                      "border border-neutral-200 shadow-sm",
                      "focus:outline-none focus:border-neutral-300 focus:shadow-md",
                      "transition-all duration-200",
                      "placeholder:text-neutral-400",
                      "disabled:opacity-50"
                    )}
                  />
                  <button
                    type="button"
                    onClick={triggerFileUpload}
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-full transition-all"
                    title="Attach files"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    {(input.trim() || attachedFiles.length > 0) && (
                      <button type="submit" disabled={isLoading} className="p-2 text-neutral-400 hover:text-neutral-600 transition-colors">
                        <Send className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveMode('voice')}
                      className="p-2.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-all"
                      title={`Talk to ${systemName}`}
                    >
                      <Phone className="w-5 h-5" />
                    </button>
                    <MicButton />
                  </div>
                </div>
              </form>
            )}

            {/* Quick Actions - before interaction */}
            {!hasInteracted && (
              <div className="flex flex-wrap justify-center gap-2 mt-6 px-4">
                {QUICK_ACTIONS.filter((action) => {
                  if (!action.integration) return true;
                  return userSettings.integrations[action.integration as keyof typeof userSettings.integrations];
                }).map((action) => (
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

            {/* Real-time Voice Call Button - before interaction */}
            {!hasInteracted && (
              <button
                onClick={() => setActiveMode('voice')}
                className={cn(
                  "mt-6 flex items-center gap-2 px-5 py-3 text-sm font-medium rounded-full",
                  "bg-blue-500 text-white",
                  "hover:bg-blue-600 hover:shadow-md",
                  "transition-all duration-200"
                )}
              >
                <Phone className="w-4 h-4" />
                Talk to {systemName}
              </button>
            )}
          </div>

          {/* Chat Messages */}
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
                    {message.role === "assistant" && message.content && (
                      <button
                        onClick={() => playMessage(message.id, message.content)}
                        disabled={loadingAudioId === message.id}
                        className={cn(
                          "mt-1 p-1.5 rounded-full transition-all",
                          "text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100",
                          playingMessageId === message.id && "text-blue-500",
                          loadingAudioId === message.id && "opacity-50"
                        )}
                        title={playingMessageId === message.id ? "Stop" : "Play"}
                      >
                        {loadingAudioId === message.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : playingMessageId === message.id ? (
                          <VolumeX className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          {/* Floating Quick Actions - after interaction */}
          {hasInteracted && (
            <div className="fixed bottom-24 left-0 right-0 px-4">
              <div className="max-w-2xl mx-auto">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {QUICK_ACTIONS.filter((action) => {
                    if (!action.integration) return true;
                    return userSettings.integrations[action.integration as keyof typeof userSettings.integrations];
                  }).map((action) => (
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

          {/* Fixed Input at Bottom - after interaction */}
          {hasInteracted && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 p-4">
              <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {attachedFiles.map((file, index) => (
                      <div key={index} className="flex items-center gap-2 px-2 py-1 bg-neutral-100 rounded-full text-xs">
                        {getFileIcon(file)}
                        <span className="max-w-[100px] truncate">{file.name}</span>
                        <button type="button" onClick={() => removeFile(index)} className="text-neutral-400 hover:text-neutral-600">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={isRecording ? "Recording..." : `Ask ${systemName} anything...`}
                    disabled={isLoading || isRecording}
                    className={cn(
                      "w-full px-5 py-3 pl-12 pr-20 text-sm rounded-full",
                      "border border-neutral-200 shadow-sm",
                      "focus:outline-none focus:border-neutral-300 focus:shadow-md",
                      "transition-all duration-200",
                      "placeholder:text-neutral-400",
                      "disabled:opacity-50",
                      isRecording && "border-red-300 bg-red-50/30"
                    )}
                  />
                  <button
                    type="button"
                    onClick={triggerFileUpload}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-full transition-all"
                    title="Attach files"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {(input.trim() || attachedFiles.length > 0) && !isRecording && (
                      <button type="submit" disabled={isLoading} className="p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors">
                        <Send className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveMode('voice')}
                      className="p-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-all"
                      title={`Talk to ${systemName}`}
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <MicButton size="small" />
                  </div>
                </div>
              </form>
            </div>
          )}
        </>
      )}

      {/* System Naming Modal - Onboarding */}
      {user && needsOnboarding && (
        <SystemNamingModal
          isOpen={needsOnboarding}
          onComplete={completeOnboarding}
          userId={user.id}
        />
      )}
      <TaskActivityBubble />
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
