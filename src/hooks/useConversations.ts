import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const isDev = import.meta.env.DEV;

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
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const prevUserId = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // Ref mirrors activeSessionId for immediate reads in async callbacks
  const activeSessionIdRef = useRef<string | null>(null);

  // Keep ref in sync with state
  const setActiveSession = useCallback((id: string | null) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);

  // Guard against concurrent session creation
  const creatingSessionRef = useRef<Promise<string | null> | null>(null);

  // Create a new session (deduped)
  const createSession = useCallback(async (title?: string): Promise<string | null> => {
    if (!user) return null;

    // If already creating, return the same promise
    if (creatingSessionRef.current) {
      return creatingSessionRef.current;
    }

    const promise = (async () => {
      try {
        console.log("[useConversations] Creating session for user:", user.id);
        const { data, error } = await supabase
          .from("chat_sessions")
          .insert({ user_id: user.id, title: title || "New conversation" })
          .select("id, title, created_at, updated_at")
          .single();

        if (error || !data) {
          console.error("[useConversations] Failed to create session:", error);
          return null;
        }

        console.log("[useConversations] Session created:", data.id);
        setSessions((prev) => [data, ...prev]);
        setActiveSession(data.id);
        return data.id;
      } catch (e) {
        console.error("[useConversations] createSession exception:", e);
        return null;
      } finally {
        creatingSessionRef.current = null;
      }
    })();

    creatingSessionRef.current = promise;
    return promise;
  }, [user, setActiveSession]);

  // Ensure we have an active session, returns the ID
  const ensureSession = useCallback(async (): Promise<string | null> => {
    const sid = activeSessionIdRef.current;
    if (sid) return sid;
    return createSession();
  }, [createSession]);

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
    setActiveSession(sessionId);
    await loadMessages(sessionId);
  }, [loadMessages, setActiveSession]);

  // Start a new chat
  const startNewChat = useCallback(async () => {
    setActiveSession(null);
    setMessages([]);
    const id = await createSession();
    return id;
  }, [createSession, setActiveSession]);

  // Save a message to the active session
  const saveMessage = useCallback(async (msg: { id: string; role: "user" | "assistant"; content: string }) => {
    if (!user) {
      if (isDev) console.warn("[useConversations] saveMessage called without user — skipping.");
      return;
    }

    // Add to local state immediately (optimistic)
    const newMsg: ConversationMessage = {
      ...msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMsg]);

    // Ensure session exists (may create one)
    const sid = await ensureSession();
    if (!sid) {
      console.error("[useConversations] saveMessage: failed to get session — message only in local state");
      return;
    }

    // Save to DB
    const { error } = await supabase.from("chat_messages").insert({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      session_id: sid,
      user_id: user.id,
    });

    if (error) {
      console.error("[useConversations] saveMessage DB error:", error);
    } else {
      console.log("[useConversations] saveMessage saved to DB:", msg.id);
    }

    // Auto-title: if this is the first user message, update the session title
    if (msg.role === "user") {
      const existingUserMessages = messages.filter((m) => m.role === "user");
      if (existingUserMessages.length === 0) {
        const title = msg.content.slice(0, 50) + (msg.content.length > 50 ? "…" : "");
        await supabase
          .from("chat_sessions")
          .update({ title, updated_at: new Date().toISOString() })
          .eq("id", sid);
        setSessions((prev) =>
          prev.map((s) => (s.id === sid ? { ...s, title } : s))
        );
      } else {
        await supabase
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", sid);
      }
    }
  }, [user, messages, ensureSession]);

  // Update a message content (for streaming)
  const updateMessageContent = useCallback((id: string, content: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content } : m))
    );
  }, []);

  // Update message in DB after streaming completes
  const finalizeMessage = useCallback(async (msg: { id: string; role: "user" | "assistant"; content: string }) => {
    if (!user) {
      if (isDev) console.warn("[useConversations] finalizeMessage called without user — skipping.");
      return;
    }

    const sid = await ensureSession();
    if (!sid) return;

    // Upsert the message
    const { error } = await supabase.from("chat_messages").upsert({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      session_id: sid,
      user_id: user.id,
    });

    if (error) {
      console.error("[useConversations] finalizeMessage DB error:", error);
    }

    // Auto-title: if this is the first user message, update the session title
    if (msg.role === "user") {
      const userMessages = messages.filter((m) => m.role === "user");
      if (userMessages.length === 0) {
        const title = msg.content.slice(0, 50) + (msg.content.length > 50 ? "…" : "");
        await supabase
          .from("chat_sessions")
          .update({ title, updated_at: new Date().toISOString() })
          .eq("id", sid);
        setSessions((prev) =>
          prev.map((s) => (s.id === sid ? { ...s, title } : s))
        );
      } else {
        await supabase
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", sid);
      }
    }
  }, [user, messages, ensureSession]);

  // Delete a session
  const deleteSession = useCallback(async (sessionId: string) => {
    if (!user) return;

    await supabase.from("chat_messages").delete().eq("session_id", sessionId).eq("user_id", user.id);
    await supabase.from("chat_sessions").delete().eq("id", sessionId).eq("user_id", user.id);

    setSessions((prev) => prev.filter((s) => s.id !== sessionId));

    if (activeSessionIdRef.current === sessionId) {
      setActiveSession(null);
      setMessages([]);
    }
  }, [user, setActiveSession]);

  // Initialization: load sessions, reset when user changes
  useEffect(() => {
    mountedRef.current = true;
    if (!user) {
      setSessions([]);
      setActiveSession(null);
      setMessages([]);
      setSessionsLoaded(false);
      prevUserId.current = null;
      return;
    }

    // Skip if same user already initialized
    if (prevUserId.current === user.id) return;
    prevUserId.current = user.id;

    const init = async () => {
      console.log("[useConversations] Initializing for user:", user.id);

      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id, title, created_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("[useConversations] loadSessions error:", error);
        setSessionsLoaded(true);
        return;
      }

      const loadedSessions = data || [];
      console.log("[useConversations] Loaded", loadedSessions.length, "sessions");
      setSessions(loadedSessions);

      if (loadedSessions.length === 0) {
        console.log("[useConversations] No sessions, creating first one");
        const { data: newSession, error: createError } = await supabase
          .from("chat_sessions")
          .insert({ user_id: user.id, title: "New conversation" })
          .select("id, title, created_at, updated_at")
          .single();

        if (createError || !newSession) {
          console.error("[useConversations] Auto-create session failed:", createError);
        } else {
          console.log("[useConversations] Auto-created session:", newSession.id);
          setSessions([newSession]);
          setActiveSession(newSession.id);
          setMessages([]);
        }
      } else {
        setActiveSession(loadedSessions[0].id);
        const { data: msgs } = await supabase
          .from("chat_messages")
          .select("id, role, content, created_at")
          .eq("session_id", loadedSessions[0].id)
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (msgs) {
          setMessages(msgs.map((m) => ({ ...m, role: m.role as "user" | "assistant" })));
        }
      }

      setSessionsLoaded(true);
    };

    init();

    return () => {
      mountedRef.current = false;
    };
  }, [user, setActiveSession]);

  // Reload sessions helper
  const loadSessions = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_sessions")
      .select("id, title, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (data) setSessions(data);
  }, [user]);

  /**
   * Public contract — consumed by Index.tsx and session UI.
   * Internal mutation helpers (setMessages, updateMessageContent) are NOT
   * exposed. All message mutations flow through saveMessage / finalizeMessage.
   */
  return {
    sessions,
    activeSessionId,
    messages,
    sessionsLoaded,
    switchSession,
    startNewChat,
    saveMessage,
    finalizeMessage,
    deleteSession,
    loadSessions,
  };
}
