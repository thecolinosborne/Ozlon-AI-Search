

# ChatGPT-Style Conversation Sessions

## Current State
Right now, all messages load into one continuous stream from localStorage. There's no concept of separate conversations — every time you open the app, you see the entire history. The database already has `chat_sessions` and `chat_messages` tables ready to use.

## What Changes

### 1. Conversation sidebar with history
- Add a slide-out sidebar (hamburger menu or side panel) showing past conversations
- Each conversation shows a title (auto-generated from the first message) and timestamp
- Clicking a conversation loads those messages
- "New Chat" button at the top starts a fresh conversation

### 2. Session management hook — `useConversations`
- Manages the active session ID, list of sessions, and CRUD operations
- On sign-in: automatically creates a new session (previous ones remain accessible)
- Loads messages for the active session from the database
- Auto-titles sessions based on the first user message (truncated to ~50 chars)
- Falls back to localStorage for unauthenticated users (single session)

### 3. Update Index.tsx
- Replace the flat `messages` state with session-aware state from `useConversations`
- When sending a message, save to the active session in the database
- Pass only the current session's messages to `streamChat` (not all history)
- Clear the chat view when switching sessions or starting a new one
- Remove the old `localDb` message loading on mount

### 4. Conversation sidebar component
- Slide-out panel from the left (or drawer on mobile)
- Lists sessions grouped by "Today", "Yesterday", "Previous 7 days", etc.
- Each item shows truncated title + relative time
- Swipe-to-delete or delete button on each conversation
- "New Chat" button pinned at top

### 5. Auto-create new session on sign-in
- In `AuthContext`, when `SIGNED_IN` fires, the conversation hook picks it up and creates a fresh session
- Old sessions remain in the sidebar for reference

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useConversations.ts` | New hook — session CRUD, message loading, active session state |
| `src/components/ConversationSidebar.tsx` | New — sidebar with conversation list, new chat button |
| `src/pages/Index.tsx` | Replace flat messages with session-aware logic, add sidebar toggle |
| `src/services/localDb.ts` | Minor — keep as offline fallback but no longer primary |

## Result
- Each sign-in starts a fresh conversation
- Past conversations are accessible from a sidebar
- Messages are persisted per-session in the database
- Clean, ChatGPT-like UX with conversation management

