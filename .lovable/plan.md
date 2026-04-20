

## Issues Found

1. **"Open in chat" navigation** - The code exists in `Index.tsx` (lines 192-211) to handle `?session=` param, but there may be a timing issue where `sessionsLoaded` isn't true when the param is read.

2. **Delete button exists** - Already present in `TaskDetail.tsx` (lines 137-139) with Trash2 icon.

3. **Back button exists** - Already present in `Tasks.tsx` (lines 308-316) with ArrowLeft icon.

4. **Chat in tasks not streaming** - The `useThread.ts` hook's `sendFollowUp` function (lines 139-156) calls `execute-task` edge function instead of using `chatService.streamChat` like `ThreadView.tsx` does. This means no streaming, no tool visibility, and different behavior from main chat.

## Fix Plan

### 1. Fix `/?session=` deep-linking in Index.tsx
Add an effect that waits for sessions to load, then checks the param:

```typescript
// In Index.tsx, add after line 211 (after existing useEffect)
useEffect(() => {
  const target = searchParams.get('session');
  if (!target || !sessionsLoaded) return;
  if (switchedToParamRef.current === target) return;
  if (target === activeSessionId) {
    switchedToParamRef.current = target;
    const params = new URLSearchParams(searchParams);
    params.delete('session');
    setSearchParams(params, { replace: true });
    return;
  }
  switchedToParamRef.current = target;
  handleSwitchSession(target).then(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('session');
    setSearchParams(params, { replace: true });
  });
}, [searchParams, sessionsLoaded, activeSessionId, handleSwitchSession, setSearchParams]);
```

### 2. Fix `useThread.ts` to use streaming chat instead of execute-task
Replace the `sendFollowUp` function (lines 139-156) with streaming implementation similar to `ThreadView.tsx`:

```typescript
const sendFollowUp = useCallback(async (content: string) => {
  if (!threadId || !content.trim()) return;
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess?.session?.user?.id;
  if (!userId) return;

  // Persist user message
  const { data: userMsg, error: insertErr } = await supabase.from('chat_messages').insert({
    session_id: threadId,
    user_id: userId,
    role: 'user',
    content: content.trim(),
  }).select().single();
  if (insertErr || !userMsg) { toast.error('Failed to send'); return; }

  // Build history and stream
  const history: Message[] = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  history.push({ role: 'user', content: content.trim() });

  let assembled = '';
  await new Promise<void>((resolve) => {
    streamChat({
      messages: history,
      systemName,
      enableTools: true,
      userSettings,
      onDelta: (delta) => { assembled += delta; },
      onDone: () => resolve(),
      onError: (err) => {
        toast.error(`Chat error: ${err}`);
        resolve();
      },
    });
  });

  const finalText = assembled.trim() || '(no output)';
  
  // Persist assistant message
  const { data: asstMsg } = await supabase.from('chat_messages').insert({
    session_id: threadId,
    user_id: userId,
    role: 'assistant',
    content: finalText,
  }).select().single();

  // Extract artifact
  if (asstMsg?.id) {
    await supabase.functions.invoke('execute-task', {
      body: { thread_id: threadId, finalize_only: true, assistant_message_id: asstMsg.id },
    });
  }
}, [threadId, messages, systemName, userSettings]);
```

### 3. Add missing imports to `useThread.ts`
Add these imports at the top:
```typescript
import { streamChat, Message } from '@/services/chatService';
import { toast } from 'sonner';
```

## Files to Edit
- `src/pages/Index.tsx` - Fix deep-link session switching
- `src/hooks/useThread.ts` - Replace execute-task with streaming chat

