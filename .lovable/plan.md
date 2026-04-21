

## Reorder Settings + Merge Personality into Memory

### Current state

Settings page has these rows (in order):
1. Profile
2. Brain Stones (`/settings/brain`)
3. Personality & Identity (`/settings/personality`)
4. Memory Settings (`/settings/memory`) ← currently 404, route never registered
5. (other rows)

**Are Personality and Memory redundant?** Largely yes, with some overlap and some distinct concerns:

| Concern | Personality page | Memory page |
|---|---|---|
| System name / wake word | ✅ | ❌ |
| Tone & voice persona | ✅ | ❌ |
| Evolution proposals (AI-suggested changes) | ✅ | ❌ |
| Standing orders (rules AI obeys) | ❌ | ✅ |
| Active goals | ❌ | ✅ |
| Data source toggles (calendar, email, etc.) | ❌ | ✅ |

They're **complementary, not redundant** — Personality = *who the AI is*, Memory = *what the AI knows and obeys*. But they're conceptually one thing from a user's mental model: "shape my AI." Worth merging into a single **Identity & Memory** page with clear sections, eliminating the split.

### Plan

**1. Register the missing Memory route + reorder Settings**
- `src/App.tsx`: add `<Route path="/settings/memory" element={<MemorySettings />} />`
- `src/pages/Settings.tsx`: move Memory row to sit **directly below Brain Stones**, above Personality.

**2. Merge Personality + Memory into one unified page**
- Create `/settings/identity` (new route) rendering a single page with sectioned content:
  - **Identity** (from PersonalitySettings): system name, tone/persona, evolution proposals
  - **Standing Orders** (from MemorySettings)
  - **Active Goals** (from MemorySettings)
  - **Data Sources** (from MemorySettings)
- Settings page collapses two rows ("Personality & Identity" + "Memory Settings") into one row: **"Identity & Memory"** → `/settings/identity`, placed directly below Brain Stones.
- Keep `/settings/personality` and `/settings/memory` as redirects to `/settings/identity` so existing links don't break.

### Files touched
- `src/App.tsx` — add new route + 2 redirects
- `src/pages/Settings.tsx` — collapse two rows into one, reorder
- `src/pages/IdentityMemory.tsx` (new) — composes existing PersonalitySettings + MemorySettings section content
- Existing `MemorySettings.tsx` and `PersonalitySettings.tsx` stay on disk as building blocks (their internal sections get reused) — no behavior loss.

### Out of scope
- No changes to standing-order, goal, or evolution-proposal logic — pure UI composition.
- No nav bar changes. No changes to other settings rows.
- No schema/RLS/edge function changes.

### If you'd rather keep them separate

Say the word and I'll skip the merge — just register `/settings/memory` and reorder Memory to sit below Brain Stones, leaving Personality as its own row underneath.

