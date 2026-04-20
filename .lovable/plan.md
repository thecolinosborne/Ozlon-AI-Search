

## Settings Refresh + Wisdom Library Section

Two things, scoped tight: modernize `/settings` visuals only (no nav changes anywhere), and give Wisdom Library its own first-class section inside Settings with quick-upload affordances.

## What changes

### 1. Profile hero card (top of Settings)
Replace the small Account row with a presence-forward header:
- Large avatar with gradient ring, initials fallback
- Display name (weight 600) + email muted below
- Status pill: `● Signed in` (primary dot) or `● Guest` (muted dot)
- Right-aligned **Edit Profile** ghost button → `/profile`
- Guest variant: "Sign in to unlock" CTA → `/auth`

### 2. Reorganize Settings sections (in-page only, no nav)
1. **Profile** — hero card
2. **Personalization** — OS Name (inline edit), Personality, Brain Stones
3. **Voice & Communication** — Mode (segmented control), Voice features toggle, Auto-play, Preview
4. **Wisdom Library** — dedicated section (see #4)
5. **Memory** — Memory Settings link
6. **Integrations** — single row → `/integrations`
7. **Data & Privacy** — Clear chat history
8. **Account** — Sign out (signed-in only)

The bespoke "System" section disappears; OS Name moves into Personalization as an inline-edit row.

### 3. Segmented control for Communication Mode
Three mutually exclusive toggles → one row with a 3-pill segmented control (`Text` / `Voice` / `Both`). Active pill: `bg-primary/15 text-primary`. New small reusable component.

### 4. Wisdom Library — its own section in Settings
A featured block (not just a row) so it feels like a real capability:
- Section title "Wisdom Library" with "New" accent
- **Stat strip**: `X sources · Y entries · Z memories` (live counts via `wisdomService`)
- **Three quick-action tiles** in a responsive row:
  - **Paste Text** → opens `/wisdom?mode=text`
  - **Upload Document** → opens `/wisdom?mode=upload`
  - **From URL** → opens `/wisdom?mode=url`
- **Open Library** ghost button at the bottom → `/wisdom`
- Empty state (zero sources): friendly one-liner + same tiles
- New component: `src/components/settings/WisdomLibraryCard.tsx`
- `Wisdom.tsx` reads `?mode=` on mount and pre-selects the matching tab in `AddSourcePanel`

### 5. SettingsRow polish (additive props only)
- Optional `badge` prop (small pill: "New", "Beta", count)
- Icon container gets subtle gradient `from-muted/80 to-muted/40`
- Hover gets soft ring `shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]`
- Inline-edit variant for OS Name (click row → input replaces label, Save/Cancel inline)

### 6. SettingsSection polish
- Title gets a 2px primary/40 gradient accent bar to the left
- Rows render inside a soft grouped container `bg-card/30 rounded-2xl p-2`
- Spacing between sections bumped to `mb-10`

### 7. Header polish (Settings page only)
- Sticky header gets `bg-background/80 backdrop-blur-xl` to match app shell
- Right-side "Done" action on mobile returns to `/`

## Files

**New**:
- `src/components/settings/ProfileHeroCard.tsx`
- `src/components/settings/SegmentedControl.tsx`
- `src/components/settings/WisdomLibraryCard.tsx`

**Edited**:
- `src/pages/Settings.tsx` — restructure, swap System block for inline OS Name, mount Wisdom section
- `src/components/settings/SettingsRow.tsx` — `badge` prop, gradient icon, inline-edit variant
- `src/components/settings/SettingsSection.tsx` — accent bar, grouped container
- `src/pages/Wisdom.tsx` — read `?mode=` query param to pre-select Add Source tab

**Untouched**: All app navigation (BottomNav, CommandPalette, App.tsx routes), all auth/voice/OS-name/clear-chat/sign-out logic, store, routing.

## Verification

1. `/settings` opens → Profile hero card at top with avatar, name, status pill
2. Communication Mode shows as one row with active Text/Voice/Both pill
3. OS Name editor lives inline in Personalization (no separate System section)
4. Wisdom Library section visible with live counts + three quick-action tiles
5. Click "Upload Document" tile → lands on `/wisdom` with Upload tab pre-selected
6. Section headers have left accent bars; rows feel grouped
7. Sign out / clear chat dialogs unchanged behavior
8. Mobile (375px): no horizontal scroll, tiles stack cleanly
9. No app navigation changed anywhere

## Outcome

Settings becomes a modern control center with the Wisdom Library promoted to its own featured section — discoverable, with one-tap entry into each upload mode — without touching any navigation surface.

