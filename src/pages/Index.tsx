import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, MessageSquare, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserSettings } from "@/services/chatService";
import { UserMenu } from "@/components/UserMenu";
import { SystemNamingModal } from "@/components/SystemNamingModal";
import { useAuth } from "@/contexts/AuthContext";
import { useAppStore } from "@/stores/useAppStore";
import { useTaskActivityStore } from "@/stores/useTaskActivityStore";
import { toast } from "sonner";
import { voiceService } from "@/services/voiceService";
import { supabase } from "@/integrations/supabase/client";
import { RealtimeVoiceChat } from "@/components/RealtimeVoiceChat";
import { TaskActivityBubble } from "@/components/TaskActivityBubble";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { useConversations } from "@/hooks/useConversations";
import { useChatStream, ChatMessage } from "@/hooks/useChatStream";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useVoicePlayback } from "@/hooks/useVoicePlayback";
import { useFileAttachments } from "@/hooks/useFileAttachments";
import { ChatHero } from "@/components/chat/ChatHero";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { QuickActionsBar, QuickAction } from "@/components/chat/QuickActionsBar";

const Index = () => {
  const navigate = useNavigate();
  const { authLoading, session, user, systemName, needsOnboarding, profileLoaded, isReturningUser, completeOnboarding, voiceEnabled } = useAuth();
  const isAuthenticated = !!session && !!user;
  const { user: storeUser, connections, agents } = useAppStore();

  // ── Persisted conversation state ─────────────────────────────────────
  const {
    sessions, activeSessionId, messages: sessionMessages,
    sessionsLoaded, switchSession, startNewChat, saveMessage,
    finalizeMessage, deleteSession,
  } = useConversations();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<"chat" | "voice">("chat");
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);
  const prevUserIdRef = useRef<string | null>(null);

  // ── Ephemeral UI-only messages (welcome, tips — never persisted) ────
  const [ephemeralMessages, setEphemeralMessages] = useState<ChatMessage[]>([]);
  const [welcomeShown, setWelcomeShown] = useState(false);
  const [chatViewLatched, setChatViewLatched] = useState(false);
  const [lastStableVisibleMessages, setLastStableVisibleMessages] = useState<ChatMessage[]>([]);

  // Build user settings — memoized to avoid re-creating on every render
  const userSettings: UserSettings = useMemo(() => ({
    communicationMode: storeUser?.communicationMode || "both",
    integrations: {
      calendar: connections.find((c) => c.id === "calendar")?.connected || false,
      email: connections.find((c) => c.id === "email")?.connected || false,
      banking: connections.find((c) => c.id === "banking")?.connected || false,
    },
    agents: {
      memory: agents.find((a) => a.id === "memory")?.enabled || false,
      orchestration: agents.find((a) => a.id === "orchestration")?.enabled || false,
      communication: agents.find((a) => a.id === "communication")?.enabled || false,
      personality: agents.find((a) => a.id === "personality")?.enabled || false,
      banking: agents.find((a) => a.id === "banking")?.enabled || false,
      summary: agents.find((a) => a.id === "summary")?.enabled || false,
    },
    osName: systemName,
  }), [storeUser?.communicationMode, connections, agents, systemName]);

  // Convert persisted session messages to ChatMessage type
  const persistedMessages: ChatMessage[] = useMemo(
    () => sessionMessages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
    [sessionMessages]
  );

  // Hooks
  const { playingMessageId, loadingAudioId, playMessage } = useVoicePlayback();
  const { input, setInput, isLoading, inflightMessages, sendMessage, abortStream } = useChatStream({
    persistedMessages, systemName, userSettings, autoPlayEnabled,
    saveMessage, finalizeMessage, playMessage,
  });
  const { isRecording, isTranscribing, handleMicClick } = useVoiceRecorder({
    onTranscribed: (text) => setInput(text),
  });
  const { attachedFiles, fileInputRef, handleFileSelect, removeFile, triggerFileUpload } = useFileAttachments();
  

  // ── Single source of truth for rendered messages ─────────────────────
  // Three layers merged: persisted > inflight > ephemeral.
  // Inflight wins over persisted (latest streaming content).
  // Ephemeral is appended only when no real messages exist.
  const visibleMessages: ChatMessage[] = useMemo(() => {
    let merged: ChatMessage[];
    if (inflightMessages.length === 0) {
      merged = persistedMessages;
    } else {
      const inflightIds = new Set(inflightMessages.map((m) => m.id));
      const base = persistedMessages.filter((m) => !inflightIds.has(m.id));
      merged = [...base, ...inflightMessages];
    }

    if (ephemeralMessages.length > 0) {
      if (merged.length === 0) return ephemeralMessages;
      return merged;
    }

    return merged;
  }, [persistedMessages, inflightMessages, ephemeralMessages]);

  useEffect(() => {
    if (visibleMessages.length === 0) return;
    setChatViewLatched(true);
    setLastStableVisibleMessages(visibleMessages);
  }, [visibleMessages]);

  const renderedMessages = visibleMessages.length > 0
    ? visibleMessages
    : chatViewLatched
      ? lastStableVisibleMessages
      : visibleMessages;

  const hasInteracted = chatViewLatched || renderedMessages.length > 0;

  // ── Ephemeral state reset helper ─────────────────────────────────────
  const resetEphemeralState = useCallback(() => {
    setEphemeralMessages([]);
    setWelcomeShown(false);
    setChatViewLatched(false);
    setLastStableVisibleMessages([]);
  }, []);

  // Reset store on user change
  useEffect(() => {
    if (!user) { prevUserIdRef.current = null; return; }
    if (prevUserIdRef.current && prevUserIdRef.current !== user.id) {
      useAppStore.getState().reset();
      resetEphemeralState();
    }
    prevUserIdRef.current = user.id;
  }, [user, resetEphemeralState]);

  // Redirect to onboarding
  useEffect(() => {
    if (!authLoading && profileLoaded && isAuthenticated && needsOnboarding) navigate("/onboarding");
  }, [authLoading, profileLoaded, isAuthenticated, needsOnboarding, navigate]);

  // Load auto-play setting
  useEffect(() => {
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { settings } = await voiceService.getSettings();
          setAutoPlayEnabled(settings?.auto_play_responses ?? false);
        }
      } catch (e) { console.error("Failed to load auto-play setting:", e); }
    };
    load();
  }, []);

  // Welcome message for returning users — ephemeral only, never persisted
  useEffect(() => {
    if (isReturningUser && !welcomeShown && persistedMessages.length === 0 && inflightMessages.length === 0 && sessionsLoaded && activeSessionId) {
      setWelcomeShown(true);
      setEphemeralMessages([{
        id: `ephemeral-welcome-${activeSessionId}`,
        role: "assistant",
        content: `Welcome back! ${systemName} is ready to help. What would you like to do today?`,
      }]);
    }
  }, [isReturningUser, welcomeShown, systemName, persistedMessages.length, inflightMessages.length, sessionsLoaded, activeSessionId]);

  const handleQuickAction = useCallback((action: QuickAction) => {
    sendMessage(action.message, action.intent);
  }, [sendMessage]);

  // ── Session transition handlers ──────────────────────────────────────
  // All transitions: abort stream (which fails stale tasks), reset ephemeral,
  // and clear completed task UI to prevent cross-session leaks.
  const handleNewChat = useCallback(async () => {
    abortStream();
    resetEphemeralState();
    await startNewChat();
  }, [abortStream, resetEphemeralState, startNewChat]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    abortStream();
    resetEphemeralState();
    await switchSession(sessionId);
  }, [abortStream, resetEphemeralState, switchSession]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    abortStream();
    resetEphemeralState();
    await deleteSession(sessionId);
  }, [abortStream, resetEphemeralState, deleteSession]);

  // Shared composer props — memoized to stabilize child renders
  const composerProps = useMemo(() => ({
    input, onInputChange: setInput, onSubmit: () => sendMessage(input),
    onMicClick: handleMicClick, isRecording, isTranscribing, isLoading,
    placeholder: `Ask ${systemName} anything...`,
    attachedFiles, onRemoveFile: removeFile, onAttach: triggerFileUpload,
  }), [input, setInput, sendMessage, handleMicClick, isRecording, isTranscribing, isLoading, systemName, attachedFiles, removeFile, triggerFileUpload]);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <ConversationSidebar
        open={sidebarOpen} onClose={() => setSidebarOpen(false)}
        sessions={sessions} activeSessionId={activeSessionId}
        onNewChat={handleNewChat} onSelectSession={handleSwitchSession} onDeleteSession={handleDeleteSession}
      />

      {/* Global File Input */}
      <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.webp"
        onChange={handleFileSelect} className="hidden" aria-hidden="true" />

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 px-4 py-4 z-[60] bg-white/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg hover:bg-neutral-100 transition-colors" title="Conversations">
                <Menu className="w-5 h-5 text-neutral-600" />
              </button>
            )}
            <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-full">
              <button type="button" onClick={() => setActiveMode("chat")}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-all",
                  activeMode === "chat" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>
                <MessageSquare className="w-4 h-4" /> Chat
              </button>
              <button type="button" disabled={!isAuthenticated}
                onClick={() => {
                  if (!isAuthenticated) { toast.error("Sign in to use voice conversation"); return; }
                  if (!voiceEnabled) { toast.error("Enable voice conversation in Settings first"); return; }
                  setActiveMode("voice");
                }}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-all",
                  activeMode === "voice" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700",
                  !isAuthenticated && "opacity-50 cursor-not-allowed")}
                title={!isAuthenticated ? "Sign in to enable voice" : !voiceEnabled ? "Enable in Settings" : "Voice conversation"}>
                <Phone className="w-4 h-4" /> Voice
              </button>
            </div>
          </div>
          <UserMenu />
        </div>
      </header>

      {/* Voice Mode */}
      {activeMode === "voice" && isAuthenticated && voiceEnabled && (
        <RealtimeVoiceChat systemName={systemName} onClose={() => setActiveMode("chat")} />
      )}
      {activeMode === "voice" && (!isAuthenticated || !voiceEnabled) && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
          <button onClick={() => setActiveMode("chat")} className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors text-sm">Close</button>
          <div className="w-24 h-24 rounded-full bg-neutral-700 flex items-center justify-center mb-8">
            <Phone className="w-10 h-10 text-neutral-400" />
          </div>
          <h2 className="text-white text-2xl font-light mb-4">Voice Conversation</h2>
          {!isAuthenticated ? (
            <>
              <p className="text-neutral-400 text-center mb-6 max-w-sm">Sign in to enable voice conversation with {systemName}.</p>
              <a href="/auth" className="px-6 py-3 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 transition-colors">Sign in</a>
            </>
          ) : (
            <>
              <p className="text-neutral-400 text-center mb-6 max-w-sm">Turn on Voice Mode in Settings to use voice conversation.</p>
              <a href="/settings" className="px-6 py-3 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 transition-colors">Go to Settings</a>
            </>
          )}
        </div>
      )}

      {/* Chat Mode */}
      {activeMode === "chat" && (
        <>
          {!hasInteracted && (
            <ChatHero systemName={systemName} composerProps={composerProps} onQuickAction={handleQuickAction}
              userSettings={userSettings} disabled={isLoading || isRecording} />
          )}

          {hasInteracted && (
            <ChatMessageList messages={renderedMessages} playMessage={playMessage}
              playingMessageId={playingMessageId} loadingAudioId={loadingAudioId} />
          )}

          {hasInteracted && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 p-4">
              <ChatComposer {...composerProps} mode="docked" />
            </div>
          )}
        </>
      )}

      {user && needsOnboarding && (
        <SystemNamingModal isOpen={needsOnboarding} onComplete={completeOnboarding} userId={user.id} />
      )}
      <TaskActivityBubble />
    </div>
  );
};

export default Index;
