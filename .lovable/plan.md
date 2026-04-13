

# Refine ChatComposer into a Premium Reusable Component

The structure already exists from the prior refactor. This pass focuses on quality improvements — reliable autoresize, polished visuals, and cleaner internals.

## Changes

### 1. `ChatComposer.tsx` — Improved autoresize + design polish

- Add `useEffect` watching `input` to trigger autoresize when text is set programmatically (voice transcription). Current code only resizes on `onChange`, so transcribed text doesn't resize the textarea.
- Use `useCallback` for `autoResize` and call it from both `onChange` and the `useEffect`.
- Add `bg-white` explicitly to textarea for both modes (currently inherits, can be inconsistent).
- Improve send button: show as a filled circle when content is present (more ChatGPT-like).
- Add subtle `ring` focus style instead of just border change.
- Clean up the `pr` padding — hero mode also needs `pr` space for right-side buttons (currently missing, buttons can overlap text).

### 2. `AttachmentChips.tsx` — Design upgrade

- Add image thumbnail preview for image files (show tiny preview instead of generic icon).
- Use `transition-all` on chips for smooth add/remove.
- Add `group` hover on chip to reveal the X button (less busy default state).
- Slightly improve border radius and background color for a more premium feel.

### 3. `ChatComposer.tsx` — Props cleanup

- Remove `getFileIcon` from props — move the icon logic into `AttachmentChips` directly (it's presentation logic that doesn't belong in the parent).
- This simplifies the composer interface and removes one layer of prop drilling.

## Files

| File | Action |
|------|--------|
| `src/components/chat/ChatComposer.tsx` | **Rewrite** — autoresize fix, design polish, cleaner props |
| `src/components/chat/AttachmentChips.tsx` | **Rewrite** — thumbnail previews, hover reveal, polish |
| `src/components/chat/ChatHero.tsx` | **Edit** — remove `getFileIcon` from passed props |
| `src/pages/Index.tsx` | **Edit** — remove `getFileIcon` from composerProps |
| `src/hooks/useFileAttachments.ts` | **Edit** — remove `getFileIcon` (no longer needed externally) |

