
User is asking whether Option 1 (idle summarizer + auto-memory) gives them the ability to **shape the AI's personality** — feed it who they are, how they think, and have it evolve into something like Cortana/Jarvis. Short answer: partially, but not really. Let me reframe.

Option 1 as scoped is plumbing — it captures *what was said* in conversations and promotes durable facts to long-term memory. That helps the AI remember "user prefers short replies" or "user runs an agency". But it's passive extraction, not identity shaping. It won't make the AI *become* someone.

What the user actually wants is a **Personality & Identity Layer** — explicit, user-authored directives that override default behavior across every conversation. Cortana/Jarvis aren't memory systems; they're personas with codified values, voice, and loyalty to one user.

Good news: the foundation is already there. We have `wisdom_memories`, `personalization/system-identity` (custom OS name), and aesthetic-and-tone memory ("Jarvis/Batman"). What's missing is the *user-facing control surface* to author and evolve the personality directly.

## Plan — Personality & Identity Layer ("Make it yours")

### What this adds
A new settings area `/settings/personality` where the user authors:

1. **Core identity** — "You are [name]. You serve [user]. Your tone is [calm/witty/blunt/formal]. Your loyalty is to [user] above all."
2. **About me** — long-form text the user writes about themselves (background, values, goals, what they're building, how they think). This becomes the AI's model of the user.
3. **House rules** — explicit do's and don'ts ("Never suggest meditation apps", "Always push back if I'm being lazy", "Default to action over discussion").
4. **Voice & tone sliders** — formal↔casual, terse↔verbose, deferential↔challenging, warm↔stoic.
5. **Reference personas** (optional) — "Channel Jarvis: dry wit, anticipates needs, never panics" or paste your own description.

### How it plugs in
- Stored in a new `user_personality` table (one row per user, JSONB for flexibility).
- Loaded by `chat/index.ts` on every turn and prepended to the system prompt **above** the default Ozlon persona.
- The existing wisdom-engine auto-extraction (Option 1) feeds *into* this — when the AI learns something durable about you, it surfaces a "Add to your profile?" suggestion in chat rather than silently writing to memory. User stays in control.

### Evolution loop (the Cortana effect)
- After every ~20 turns, a background job proposes refinements: "I've noticed you prefer X. Update your profile?" → user approves/rejects in `/settings/personality`.
- Uses the existing `system_evolution_proposals` table (already built for this exact purpose per `wisdom-engine-evolution-proposals` memory).
- Over weeks, the persona sharpens around the real user — that's the Jarvis-grows-with-you arc.

### Files touched
- New migration: `user_personality` table (user_id PK, identity JSONB, about_me text, house_rules text[], tone_settings JSONB, reference_persona text)
- `supabase/functions/chat/index.ts` — load personality, inject at top of system prompt
- New page `src/pages/PersonalitySettings.tsx` — authoring UI with the 5 sections above
- `src/pages/Settings.tsx` — add link to Personality section
- Optional: hook into Option 1's auto-extraction to generate proposals instead of silent writes

### Relationship to Option 1
- **Option 1 alone** = AI remembers facts about you (passive)
- **This plan alone** = AI has a persona and knows who you want it to be (explicit)
- **Both together** = Jarvis. Explicit identity + evolving understanding + user-controlled growth.

Recommend shipping this **first**, then layering Option 1's auto-extraction on top so proposals flow into the personality profile instead of a silent memory store.

### Verify after
1. Open `/settings/personality`, write "You are Jarvis. Dry wit. Always honest." → save.
2. Start new chat → AI greets in that voice immediately.
3. Edit "About me" with your background → ask "what should I work on today?" → AI references your context.
4. After ~20 messages, check Settings for an evolution proposal.
5. Reject a proposal → confirm it doesn't apply.

Approve and I'll ship it.
