import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ConversationSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export function useConversations() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sessionsLoaded, setSessnsLoaded] = useState(false);
  const creatingSession = useRef(false);

  // Load all sessions for the user
  const loadSessions = useCallback(async () => {
    if (!user) {
      setSessions([]);
      setSessnsLoaded(true);
      return;
    }

    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id, title, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (!error && data) {
      setSessions(data);
    }
    setSessnsLoaded(true);
  }, [user]);

  // Create a new session
  const createSession = useCallback(async (title?: string): Promise<string | null> => {
    if (!user || creatingSession.current) return null;
    creatingSession.current = true;

    try {
      const { data, error } = await supabase
        .from("chat_sessions")
        .insert({ user_id: user.id, title: title || "New conversation" })
        .select("id, title, created_at, updated_at")
        .single();

      if (error || !data) {
        console.error("Failed to create session:", error);
        return null;
      }

      setSessions((prev) => [data, ...prev]);
      setActiveSessionId(data.id);
      setMessages([]);
      return data.id;
    } finally {
      creatingSession.current = false;
    }
  }, [user]);

  // Load messages for a session
  const loadMessages = useCallback(async (sessionId: string) => {
    if (!user) return;

    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data.map((m) => ({ ...m, role: m.role as "user" | "assistant" })));
    }
  }, [user]);

  // Switch to a session
  const switchSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    await loadMessages(sessionId);
  }, [loadMessages]);

  // Start a new chat
  const startNewChat = useCallback(async () => {
    const id = await createSession();
    if (id) {
      setMessages([]);
    }
    return id;
  }, [createSession]);

  // Save a message to the active session
  const saveMessage = useCallback(async (msg: { id: string; role: "user" | "assistant"; content: string }) => {
    if (!user || !activeSessionId) return;

    // Add to local state immediately
    const newMsg: ConversationMessage = {
      ...msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMsg]);

    // Save to DB
    await supabase.from("chat_messages").insert({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      session_id: activeSessionId,
      user_id: user.id,
    });
  }, [user, activeSessionId]);

  // Update a message content (for streaming)
  const updateMessageContent = useCallback((id: string, content: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content } : m))
    );
  }, []);

  // Update message in DB after streaming completes
  const finalizeMessage = useCallback(async (msg: { id: string; role: "user" | "assistant"; content: string }) => {
    if (!user || !activeSessionId) return;

    // Upsert — the message may already exist from saveMessage or may be the assistant placeholder
    await supabase.from("chat_messages").upsert({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      session_id: activeSessionId,
      user_id: user.id,
    });

    // Auto-title: if this is the first user message, update the session title
    if (msg.role === "user") {
      const userMessages = messages.filter((m) => m.role === "user");
      if (userMessages.length === 0) {
        const title = msg.content.slice(0, 50) + (msg.content.length > 50 ? "…" : "");
        await supabase
          .from("chat_sessions")
          .update({ title, updated_at: new Date().toISOString() })
          .eq("id", activeSessionId);
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSessionId ? { ...s, title } : s))
        );
      } else {
        // Update session timestamp
        await supabase
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", activeSessionId);
      }
    }
  }, [user, activeSessionId, messages]);

  // Delete a session
  const deleteSession = useCallback(async (sessionId: string) => {
    if (!user) return;

    // Delete messages first, then session
    await supabase.from("chat_messages").delete().eq("session_id", sessionId).eq("user_id", user.id);
    await supabase.from("chat_sessions").delete().eq("id", sessionId).eq("user_id", user.id);

    setSessions((prev) => prev.filter((s) => s.id !== sessionId));

    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }, [user, activeSessionId]);

  // Load sessions on mount / user change
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-create a session when user signs in and has none active
  useEffect(() => {
    if (user && sessionsLoaded && !activeSessionId && !creatingSession.current) {
      createSession();
    }
  }, [user, sessionsLoaded, activeSessionId, createSession]);

  return {
    sessions,
    activeSessionId,
    messages,
    setMessages,
    sessionsLoaded,
    switchSession,
    startNewChat,
    saveMessage,
    updateMessageContent,
    finalizeMessage,
    deleteSession,
    loadSessions,
  };
}
