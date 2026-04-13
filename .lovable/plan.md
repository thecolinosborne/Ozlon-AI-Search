

# Refactor Index.tsx into Production Chat Architecture

The current `Index.tsx` is 918 lines containing chat streaming, voice recording, file attachments, message rendering, voice playback, quick actions, hero layout, docked input, sidebar management, and onboarding — all in one file. This refactor extracts each concern into focused hooks and components without changing any visual behavior.

## Target structure

```text
src/
  hooks/
    useChatStream.ts          — message sending, streaming, abort, safety timeout
    useVoiceRecorder.ts       — mic recording + transcription
    useVoicePlayback.ts       — TTS play/stop per message
    useFileAttachments.ts     — file selection, validation, removal
  components/chat/
    ChatComposer.tsx          — single composer: hero mode + docked mode
    ChatMessageList.tsx        — scrollable message list with markdown + play buttons
    ChatHero.tsx              — hero section (title, subtitle, composer, quick actions)
    QuickActionsBar.tsx        — (already exists, replace with shared version)
    AttachmentChips.tsx        — file chip list with remove buttons
```

## Hook extractions

### `useChatStream`
Extracted from Index.tsx lines 164-285. Owns:
- `input` / `setInput` state
- `isLoading` state
- `sendMessage(text, intent?)` — builds user message, calls `saveMessage`, creates assistant placeholder, streams via `streamChat`, handles `onDelta`/`onDone`/`onError`/`onTaskUpdate`, manages abort controller and safety timeout
- `abortStream()` — for sidebar new-chat and unmount cleanup
- Accepts deps: `messages`, conversation helpers (`saveMessage`, `updateMessageContent`, `finalizeMessage`), `userSettings`, `systemName`, `autoPlayEnabled`, `playMessage`

### `useVoiceRecorder`
Extracted from lines 309-404. Returns:
- `isRecording`, `isTranscribing`
- `handleMicClick()` — toggles recording, on stop transcribes via edge function, sets result into a provided callback (`onTranscribed: (text: string) => void`)
- No dependency on input state — just calls back with transcribed text

### `useVoicePlayback`
Extracted from lines 288-306. Returns:
- `playingMessageId`, `loadingAudioId`
- `playMessage(id, text)` — toggle play/stop via `voiceService`

### `useFileAttachments`
Extracted from lines 429-462. Returns:
- `attachedFiles`, `fileInputRef`
- `handleFileSelect`, `removeFile`, `triggerFileUpload`, `getFileIcon`

## Component extractions

### `ChatComposer`
One component, two rendering modes via a `mode: 'hero' | 'docked'` prop.
- Hero mode: larger padding, `rounded-3xl`, `pl-14`, centered layout
- Docked mode: smaller padding, `rounded-2xl`, `pl-12 pr-20`, fixed bottom styling
- Contains: auto-resizing textarea, paperclip button, send button, mic button (using `useVoiceRecorder` internally or via props), `AttachmentChips` above the textarea
- Accepts: `input`, `onInputChange`, `onSubmit`, `onMicClick`, `isRecording`, `isTranscribing`, `isLoading`, `placeholder`, `attachedFiles`, `onRemoveFile`, `onAttach`, `fileInputRef`, `mode`
- This eliminates the duplicated textarea + button markup currently at lines 664-713 and 836-886

### `ChatMessageList`
Extracted from lines 742-802. Renders the scrollable message list.
- Accepts: `messages`, `playMessage`, `playingMessageId`, `loadingAudioId`
- Handles: markdown rendering for assistant, `whitespace-pre-wrap` for user, typing indicator, play button, auto-scroll via `messagesEndRef`

### `ChatHero`
Extracted from lines 654-738. The pre-interaction landing.
- Renders: system name title, subtitle, `ChatComposer` in hero mode, `QuickActionsBar`
- Accepts: `systemName`, composer props, quick action handler, `userSettings`

### `AttachmentChips`
Small presentational component for the file chip list with remove buttons.
- Accepts: `files`, `onRemove`, `getFileIcon`, `size?: 'normal' | 'small'`

### `QuickActionsBar` (replace existing)
Replace the duplicated inline quick action rendering (hero version lines 717-737, floating version lines 806-831) with one shared component.
- Accepts: `actions`, `onAction`, `disabled`, `variant: 'hero' | 'floating'`

## Resulting Index.tsx (~150 lines)

```text
Index.tsx will:
  1. Call auth hooks (useAuth, useAppStore)
  2. Call useConversations()
  3. Call useChatStream(...)
  4. Call useVoiceRecorder(...)
  5. Call useVoicePlayback()
  6. Call useFileAttachments()
  7. Build userSettings object
  8. Render layout shell:
     - ConversationSidebar
     - Header with chat/voice toggle + UserMenu
     - Voice mode overlay (RealtimeVoiceChat)
     - Chat mode: ChatHero or (ChatMessageList + floating QuickActionsBar + docked ChatComposer)
     - SystemNamingModal
     - TaskActivityBubble
```

## Files

| File | Action |
|------|--------|
| `src/hooks/useChatStream.ts` | **Create** |
| `src/hooks/useVoiceRecorder.ts` | **Create** |
| `src/hooks/useVoicePlayback.ts` | **Create** |
| `src/hooks/useFileAttachments.ts` | **Create** |
| `src/components/chat/ChatComposer.tsx` | **Create** |
| `src/components/chat/ChatMessageList.tsx` | **Create** |
| `src/components/chat/ChatHero.tsx` | **Create** |
| `src/components/chat/AttachmentChips.tsx` | **Create** |
| `src/components/chat/QuickActionsBar.tsx` | **Replace** existing with shared version |
| `src/pages/Index.tsx` | **Rewrite** — thin orchestrator, ~150 lines |

## What stays unchanged
- `ConversationSidebar`, `RealtimeVoiceChat`, `TaskActivityBubble`, `SystemNamingModal`, `UserMenu` — untouched
- `useConversations` hook — untouched
- `chatService`, `voiceService` — untouched
- All visual styling preserved exactly
- Auth flow, onboarding redirect, welcome message logic — preserved
- Chat/Voice mode toggle — preserved in Index.tsx header

