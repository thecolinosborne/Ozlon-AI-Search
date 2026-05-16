## What's broken today

Ask Ozlon for "a 15-minute teleprompter" and you get ~400 clipped words with H2 headings and bullets. Three root causes in `supabase/functions/chat/index.ts`:

1. **No length contract.** The prompt has CONVERSATIONAL and DOCUMENT modes — nothing for spoken-word or long-form. The model has no idea 15 min ≈ 2,250 words.
2. **Brevity rules leak everywhere.** "≤3 sentence paragraphs," "match the energy of the question," and the `mem://design/voice-and-vocabulary` 14-word rule force a clipped voice even when you want flowing prose.
3. **Wrong skeleton.** DOCUMENT MODE forces Title + Executive Summary + Recommendations — a teleprompter reader would read those out loud.

Token cap isn't the issue (`gpt-5.4` = 16,384, plenty for 2.5k words). The model is stopping early because the *prompt* tells it to.

---

## The 2026 fix — a Long-Form Engine, not just a new prompt mode

Instead of stapling one more mode onto a wall-of-text system prompt, build a small **Long-Form Engine** that runs alongside the existing chat loop. Five layers, all server-side, no UI rewrite.

### Layer 1 — Intent + spec extraction (the "brief")

Before the main generation call, a fast pre-pass (`gemini-3-flash-preview`, ~300ms, structured output via `Output.object`) turns the user's request into a typed `LongFormBrief`:

```ts
{
  kind: 'teleprompter' | 'speech' | 'voiceover' | 'podcast' | 'sermon' |
        'keynote' | 'essay' | 'article' | 'blog' | 'story' | 'chapter' |
        'newsletter' | 'sales_letter' | 'social_thread',
  target_words: number,          // derived from duration/pages/explicit count
  target_minutes?: number,
  wpm: 150 | 180 | 220,          // spoken / podcast / read silently
  audience: string,
  voice: 'jarvis' | 'storyteller' | 'expert' | 'hype' | 'plain' | 'user_clone',
  tone_adjectives: string[],
  reading_level: 'grade-7' | 'grade-10' | 'pro',
  structure: 'continuous' | 'scene-paragraphs' | 'chaptered',
  must_include: string[],        // names, facts, hooks, CTAs
  must_avoid: string[],          // jargon, clichés, banned words
  breath_cues: boolean,          // [pause] [beat] inline
  cta?: string,
  format: 'prose' | 'script' | 'screenplay' | 'two-column-vo'
}
```

If the user under-specified ("write me a teleprompter"), the brief is filled with smart defaults AND the response opens with one inline italic line: `*Assuming ~15 min · conversational · grade-8 · no CTA. Reply with tweaks and I'll regenerate.*` — no blocking question, no roundtrip.

### Layer 2 — Outline-first generation (only when target_words > 400)

For anything long, the engine first emits a private outline (3–12 beats, each with a target word budget that sums to `target_words`) and then drafts section by section. This single change is the biggest quality lever in 2026 long-form work — models stay coherent across thousands of tokens when they have a budget per beat instead of one open-ended ask.

Outline lives in a hidden `<plan>` block stripped before sending to the client. Each beat is drafted in a loop with the previous beat's last 2 sentences as continuity context.

### Layer 3 — Self-verifying length + voice loop

After draft, a cheap verifier pass (`gpt-5.4-nano` or `gemini-3-flash-lite`) checks:
- **Length** within 90–110% of `target_words`.
- **Voice** matches `tone_adjectives` (1–5 score).
- **Forbidden patterns**: no headings if `format=prose`, no bullets unless requested, no AI-tells ("In conclusion," "Let's dive in," "It's important to note"), no banned words.
- **Hook strength**: first 50 words score (1–5).
- **Ending lands**: last sentence is a closing line, not a mid-thought.

If any check fails, one repair pass is fired with a surgical patch instruction ("expand beats 4 and 7 by ~180 words each, in the same voice, no new claims"). Max 1 repair to bound latency and cost.

### Layer 4 — Voice cloning from your own writing

You already store wisdom + writing samples (`wisdom_memories`, conversation history). Add a `voice_profile` retrieval step: when `voice='user_clone'` or the user says "in my voice," pull the top-K most stylistically representative snippets (cosine over pgvector) and inject them as few-shot exemplars in the drafter's system message. This is what makes 2026 long-form not feel like generic GPT — it sounds like you.

### Layer 5 — Token + model selection per length

| Target words | Model | max_completion_tokens | Pass count |
|---|---|---|---|
| ≤ 400 | current default | 16,384 | 1 (single shot) |
| 400 – 1,500 | `gpt-5.4` | 24,000 | outline + draft |
| 1,500 – 4,000 | `gpt-5.4` | 32,000 | outline + per-beat draft |
| > 4,000 | `gpt-5.4-pro` or `gpt-5.5` | 48,000 | outline + per-beat + stitch |

Bumped caps apply only to long-form calls — `MODEL_REGISTRY` defaults stay untouched. If the chosen model rejects the cap, fall back to the next tier.

---

## Output contract by `kind`

| Kind | Layout | Cadence | Cues | Closing |
|---|---|---|---|---|
| teleprompter / speech | Scene-paragraphs, 3–6 sentences, blank lines between | Spoken rhythm, contractions, varied length | `[pause]` `[beat]` optional | Strong landing line + `*~2,240 words · ~15 min @ 150 wpm*` |
| voiceover / podcast | Two-column allowed (`VO:` / `SFX:`) | Conversational, fewer subordinate clauses | Allowed | Same word-count footer |
| essay / article / blog | Continuous prose, optional H2 only for true sections | Reading rhythm, longer sentences ok | None | `*~1,180 words · ~6 min read*` |
| sales_letter | Hook → problem → mechanism → proof → CTA | Punchy, second person | None | Single CTA line |
| story / chapter | Scene breaks (`***`), dialogue formatted | Narrative voice | None | Cliffhanger or resolution per brief |
| newsletter | Subject line + preheader + body | User's voice clone preferred | None | Sign-off block |

The 14-word-sentence rule from `mem://design/voice-and-vocabulary` is **explicitly scoped to CONVERSATIONAL replies only.** Memory file gets updated in the same pass.

---

## Streaming UX (small, additive)

The frontend already streams. Two small additive touches in `MessageBubble.tsx` when a long-form response is detected (server tags the message with `meta.longform = { kind, target_words, actual_words }`):

- A subtle live counter under the orb while streaming: `420 / 2,250 words · 1:30 elapsed`. Disappears on completion.
- A small chip row under the finished message: `▸ Continue` · `▸ Tighter (-20%)` · `▸ Longer (+30%)` · `▸ Different voice` · `▸ Send to Google Doc`. Each sends a pre-formed prompt — no new UI surface, just a `QuickActions`-style row using existing styling. Hidden if `kind` is unset.

Optional and gated behind `meta.longform`. Zero impact on normal chat.

---

## Files touched

| File | Change |
|---|---|
| `supabase/functions/chat/_longform/brief.ts` (new) | Brief extractor — structured output via `Output.object`. |
| `supabase/functions/chat/_longform/outline.ts` (new) | Outline planner with per-beat word budgets. |
| `supabase/functions/chat/_longform/drafter.ts` (new) | Per-beat drafting loop with continuity context. |
| `supabase/functions/chat/_longform/verify.ts` (new) | Length / voice / forbidden-pattern checks + one repair pass. |
| `supabase/functions/chat/_longform/voice.ts` (new) | Pull user voice exemplars from `wisdom_memories` via pgvector. |
| `supabase/functions/chat/index.ts` | Detect long-form intent → route through engine → attach `meta.longform` to stream. Dynamic `max_completion_tokens` per tier. ~80 lines added, no existing logic removed. |
| `src/components/chat/MessageBubble.tsx` | Render live word counter + chip row when `meta.longform` present. Both behind a feature flag. |
| `src/types/index.ts` | Add `longform` field to `Message.meta`. |
| `mem://design/voice-and-vocabulary` | Scope 14-word rule to conversational mode. |
| `mem://chat/long-form-engine` (new) | Document the brief schema, model tiers, and output contract. |

No new tables. No migrations. No new edge functions. Existing chat path untouched for short replies.

---

## What you'll feel

- **"15-min teleprompter on agency moats"** → 2,250 ± 100 words, scene-paragraphs, your voice (if you opt in), optional `[pause]` cues, ends with a real closing line and the word-count footer.
- **"1,200-word LinkedIn post in my voice"** → 1,150–1,250 words, no headings, contractions on, sounds like your prior posts, ready to paste.
- **"5-min keynote opener, hype tone"** → ~750 words, punchy rhythm, strong hook in first 50 words, clean handoff line.
- **Short questions** → identical to today. The engine never fires.

---

## Three open choices for you

1. **Voice cloning depth** — Phase 1 (light: 3 exemplars from recent writing) or Phase 2 (a trained `voice_profile` per user with explicit accept/reject feedback after each draft)?
2. **Verifier model** — `gpt-5.4-nano` (best quality, ~$ per check) or `gemini-3-flash-lite` (cheapest, slightly noisier)?
3. **Chip row** — ship with the 5 chips above, or start with just `Continue` and `Tighter/Longer` and add the rest after you've used it a week?

Pick any/all and I'll start with Layer 1 + 2 + 5 (brief + outline + token tiers) since those alone close ~70% of the quality gap, then add Layers 3 and 4 next pass.
