

# Fix 5 Bugs: New Chat, Onboarding, User Isolation, Enter Key, Voice Buttons

## 1. Fix Broken New Chat (`src/hooks/useConversations.ts`)

**Problem**: `creatingSession` ref (line 25) blocks subsequent calls if it gets stuck. `initRan` ref (line 26) prevents re-initialization entirely after first load.

**Fix**:
- Remove `creatingSession` ref and its guard on line 30
- In `startNewChat`, ensure `setActiveSessionId(id)` and `setMessages([])` run explicitly (they already do via `createSession`, but add safety)
- Keep `initRan` but reset it when `user.id` changes (currently only resets when user is null)

**Observation notes**: `creatingSession` is a `useRef(false)` at line 25. Messages are in `useState` (line 23). `welcomeShown` in Index.tsx is `useState` (line 74) — already reset in sidebar `onNewChat` handler (line 438).

## 2. Trim Onboarding to 3 Screens (`src/pages/onboarding/index.tsx`)

**Screen 1**: WelcomeScreen (name input) — keep as-is  
**Screen 2**: New `PreferencesScreen` — combine response length (short/medium/detailed), tone (casual/neutral/polished), and interaction preference (typing/talking/both) into one screen  
**Screen 3**: CompletionScreen — keep as-is, update props

**Files to delete**:
- `src/components/onboarding/screens/PersonalSnapshotScreen.tsx`
- `src/components/onboarding/screens/DailyRhythmScreen.tsx`
- `src/components/onboarding/screens/PrimaryNeedScreen.tsx`
- `src/components/onboarding/screens/ProactivityScreen.tsx`
- `src/components/onboarding/screens/InteractionPreferenceScreen.tsx`
- `src/components/onboarding/screens/CommunicationStyleScreen.tsx`

**New file**: `src/components/onboarding/screens/PreferencesScreen.tsx`  
Props: `responseLengthPreference`, `tonePreference`, `interactionPreference`, `onResponseLengthChange`, `onToneChange`, `onInteractionChange`, `onContinue`, `isSpeaking`, `onReplay`, `onSkipAudio`

**Update** `onboarding/index.tsx`: steps = `["welcome", "preferences", "complete"]`, remove unused profile fields, simplify `handleComplete`.

## 3. Reset App Store on User Change (`src/pages/Index.tsx`)

**Problem**: `useAppStore` is persisted to localStorage (`ozlon-storage`). Switching users keeps stale connections/agents.

**Fix**: Add `useEffect` on `user?.id` that calls `useAppStore.getState().reset()` when user changes (not on initial mount). The store already has a `reset()` action (line 141 of useAppStore.ts) that resets to `initialState`.

## 4. Confirm Enter Submits Chat Input (`src/pages/Index.tsx`)

**Finding**: Both input areas (pre-interaction line 598, post-interaction line 796) are wrapped in `<form onSubmit={handleSubmit}>`. Both use `<input type="text">` (not textarea). The Send button is `type="submit"` implicitly since it's inside a form — wait, actually the Send button is `type="submit"` at line 640/837. Enter should already work on `<input type="text">` inside a `<form>`. Will verify and add explicit `onKeyDown` as safety.

**Fix**: Add `onKeyDown` to both inputs that calls `handleSubmit` on Enter (without Shift).

## 5. Remove Duplicate Voice Buttons (`src/pages/Index.tsx`)

**Remove**:
- **Phone icon inside pre-interaction input bar** (lines 644-651): the `<Phone>` button that calls `setActiveMode('voice')`
- **"Talk to Ozlon" standalone button** (lines 684-697): the blue `<Phone>` button below quick actions
- **Phone icon inside post-interaction input bar** (lines 841-848): same redundant Phone button

**Keep**:
- Chat/Voice toggle in header (lines 471-511)
- MicButton for transcription (lines 652, 849)

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useConversations.ts` | Remove `creatingSession` ref guard, fix `initRan` reset |
| `src/pages/onboarding/index.tsx` | Reduce to 3 steps, simplify profile state |
| `src/components/onboarding/screens/PreferencesScreen.tsx` | **New** — combined preferences |
| `src/pages/Index.tsx` | Remove 3 Phone buttons, add Enter key handler, add store reset on user change |
| `src/stores/useAppStore.ts` | No changes needed — `reset()` already exists |
| 6 onboarding screen files | **Delete** |

