import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const isDev = import.meta.env.DEV;

export interface ConversationSession {
  id: string;
  title: string;
  summary: string | null;
  preview: string | null;
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

  // Ref mirror of messages for stale-closure-safe reads (auto-title logic)
  const messagesRef = useRef<ConversationMessage[]>(messages);
  messagesRef.current = messages;

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
          .select("id, title, summary, created_at, updated_at")
          .single();

        if (error || !data) {
          console.error("[useConversations] Failed to create session:", error);
          return null;
        }

        console.log("[useConversations] Session created:", data.id);
        const session: ConversationSession = { ...data, preview: null };
        setSessions((prev) => [session, ...prev]);
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
      const existingUserMessages = messagesRef.current.filter((m) => m.role === "user");
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
  }, [user, ensureSession]);

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

    // Update local messages state so persisted store reflects finalized content
    setMessages((prev) => {
      const exists = prev.some((m) => m.id === msg.id);
      if (exists) {
        return prev.map((m) => m.id === msg.id ? { ...m, content: msg.content } : m);
      }
      return [...prev, { ...msg, created_at: new Date().toISOString() }];
    });

    // Auto-title: if this is the first user message, update the session title
    if (msg.role === "user") {
      const userMessages = messagesRef.current.filter((m) => m.role === "user");
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
  }, [user, ensureSession]);

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
        .select("id, title, summary, created_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (!mountedRef.current) return;

      if (error) {
        console.error("[useConversations] loadSessions error:", error);
        setSessionsLoaded(true);
        return;
      }

      const rawSessions = data || [];
      console.log("[useConversations] Loaded", rawSessions.length, "sessions");

      // Garbage-collect empty "New conversation" shells from prior aborted logins
      const emptyDefaults = rawSessions.filter((s) => (s.title === "New conversation" || !s.title));
      let kept = rawSessions;
      if (emptyDefaults.length > 0) {
        const ids = emptyDefaults.map((s) => s.id);
        const { data: counts } = await supabase
          .from("chat_messages")
          .select("session_id")
          .in("session_id", ids)
          .eq("user_id", user.id);
        const withMessages = new Set((counts || []).map((c: { session_id: string }) => c.session_id));
        const toDelete = ids.filter((id) => !withMessages.has(id));
        if (toDelete.length > 0) {
          console.log("[useConversations] GC", toDelete.length, "empty sessions");
          await supabase.from("chat_sessions").delete().in("id", toDelete).eq("user_id", user.id);
          kept = rawSessions.filter((s) => !toDelete.includes(s.id));
        }
      }

      // Fetch last user message per session as a preview fallback
      const sessionIds = kept.map((s) => s.id);
      const previewMap = new Map<string, string>();
      if (sessionIds.length > 0) {
        const { data: previews } = await supabase
          .from("chat_messages")
          .select("session_id, content, created_at, role")
          .in("session_id", sessionIds)
          .eq("user_id", user.id)
          .eq("role", "user")
          .order("created_at", { ascending: false });
        for (const row of previews || []) {
          if (!previewMap.has(row.session_id)) previewMap.set(row.session_id, row.content);
        }
      }

      const enriched: ConversationSession[] = kept.map((s) => ({
        ...s,
        preview: previewMap.get(s.id) || null,
      }));

      if (!mountedRef.current) return;
      setSessions(enriched);

      // Phase 1.5: do NOT auto-select last session. Show empty hero so each
      // sign-in is a fresh conversation. User clicks a past session OR types
      // → ensureSession creates a new one on first message.
      setActiveSession(null);
      setMessages([]);
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
   * Close the active session: if it has ≥2 messages and no summary, fire
   * the summarizer (also writes a real title). If empty, delete it.
   * Fire-and-forget — caller doesn't await.
   */
  const closeActiveSession = useCallback(async () => {
    const sid = activeSessionIdRef.current;
    if (!sid || !user) return;
    const localCount = messagesRef.current.length;
    try {
      if (localCount === 0) {
        // Empty shell — delete it
        await supabase.from("chat_sessions").delete().eq("id", sid).eq("user_id", user.id);
        return;
      }
      if (localCount >= 2) {
        // Fire-and-forget summarization (don't block sign-out)
        supabase.functions.invoke("summarize-session", { body: { session_id: sid } }).catch((e) => {
          console.error("[useConversations] summarize-session error:", e);
        });
      }
    } catch (e) {
      console.error("[useConversations] closeActiveSession error:", e);
    }
  }, [user]);

  // Listen for sign-out signal to summarize/cleanup the active session
  useEffect(() => {
    const handler = () => { void closeActiveSession(); };
    window.addEventListener("ozlon:before-signout", handler);
    return () => window.removeEventListener("ozlon:before-signout", handler);
  }, [closeActiveSession]);

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
    closeActiveSession,
  };
}
