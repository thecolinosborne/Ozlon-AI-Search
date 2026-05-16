---
name: Voice and vocabulary
description: Plain-speak rules for conversational replies — "you", relative time, no jargon, no emojis. 14-word sentence cap applies to chat replies ONLY, never to long-form deliverables.
type: preference
---
**Rule:** Use plain, direct language in conversational chat. Address the user as "you". Use relative time ("yesterday", "in 2 hours"), not timestamps. No jargon, no emojis, no AI-tells ("In conclusion", "Let's dive in", "It's important to note").

**Sentence-length cap (14 words) — SCOPED:**
- Applies to: CONVERSATIONAL replies and DOCUMENT MODE memos.
- Does NOT apply to: LONG-FORM MODE (teleprompter, speech, voiceover, podcast, essay, article, blog, story, sales letter, newsletter). Long-form deliverables need natural spoken/reading rhythm with varied sentence length — clipping every sentence to 14 words makes a teleprompter feel choppy and incomplete.

**Why:** The 14-word rule was bleeding into long-form output, making 15-minute teleprompters come out as 400 words of stilted sentence fragments. The long-form engine in `supabase/functions/chat/_longform/` explicitly overrides this rule for spoken-word and reading deliverables.
