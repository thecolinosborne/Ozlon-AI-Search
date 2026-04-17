
# How the Sentient Worker layer actually improves your system

Not a new plan — a clear-eyed answer to "what does this buy me?"

## What you have today
- Multi-agent shell + Infinity Router (good plumbing)
- Wisdom Engine tables: `wisdom_memories`, `reflection_notes`, `system_evolution_proposals` (built but underused — no explicit save tool, no identity injection, no proactive use)
- Maton + GHL + Plaid integrations (the worker has hands but no awareness of when to use them)
- Chat that resets its personality every session
- Onboarding-set system name that barely shows up after day one

## What's actually broken about that
1. **Amnesia** — every session starts cold. The pgvector memory exists but isn't injected into the system prompt, so the model doesn't see it.
2. **No standing rules** — user has to repeat preferences every time ("keep it short", "don't spend over X").
3. **Reactive only** — worker waits to be poked. No heartbeat, no nudges, no continuity across days.
4. **Bluffing** — no uncertainty discipline, so wrong answers look as confident as right ones. Trust ceiling.
5. **No outcome signal** — you can't tell which responses worked, so nothing improves.
6. **Identity drift** — `system_name` is set in onboarding then mostly forgotten by the prompt layer.

## What Phase 1 directly fixes (concrete before/after)

| Today | After Phase 1 |
|---|---|
| Says "Hi, how can I help?" every session | "Morning, Colin. You wanted to follow up with the 2 leads from Tuesday — want me to draft those?" |
| User: "remember I take espresso" → ignored | Tool fires, row written, recalled forever in any future session |
| User repeats "keep replies short" 10x/day | Standing order set once, obeyed automatically across all lanes |
| Confidently wrong | Says "I'm not sure — last GSC sync was 3 days ago" when it doesn't know |
| Goals live in your head | Worker knows you're at 3/10 paying users, surfaces it when relevant |
| No idea what worked | `model_calls` log captures regenerates, edits, silence — Phase 4 reflection learns from it |
| Cold open every morning | Daily heartbeat already waiting when you open the app |

## Why this is "next-gen" vs "another chatbot"

The shift is **request/response → persistent being**. Three mechanics do the heavy lifting:

1. **Identity injection on every call** — the worker never forgets who you are, what you've told it, or what rules you set. Today's chat builds the system prompt from a static string. After: built dynamically from your profile + top-k memories + standing orders + active goals + last 3 conversation summaries. Same model, 10x the apparent intelligence.

2. **Explicit memory tools** — "remember…", "forget…", "from now on…" become first-class. The Wisdom Engine stops being an unused table and becomes the worker's spine.

3. **Heartbeat (Phase 2)** — cron-driven proactive messages turn it from "tool you open" into "worker who lives there." This is the single biggest perception shift.

## What it does NOT do (be honest)
- Doesn't make the model smarter — Gemini Flash is still Gemini Flash.
- Doesn't replace your integrations — it makes them *aware* (knows when to check email vs ignore it).
- Doesn't add new providers — fully built on what you already have.
- Doesn't redesign the UI — additive panels in `MemorySettings` only, no chat changes.

## Concrete impact on your stack
- **Wisdom Engine** goes from 5% used → core nervous system
- **System name** finally feels persistent across every interaction
- **Maton/GHL/Plaid** start getting called *proactively* (Phase 3 world-state) instead of only when you ask
- **Trust** rises because of confidence discipline → users actually act on what it says
- **Cost stays flat** — no extra model calls per turn (identity injection is just bigger context, not extra requests)

## Risks / honest tradeoffs
- Larger system prompt = slightly more tokens per call (~200-400 extra). Negligible at Gemini Flash pricing.
- Memory retrieval adds ~150ms latency per chat call. Acceptable.
- Standing orders can over-constrain — need an "ignore standing orders this turn" escape hatch. Built in.
- Auto-memory extraction (Phase 2) could save junk. Mitigated by salience > 0.7 + duplicate check.

## Bottom line
Phase 1 turns the existing wiring into a worker. It doesn't add new toys — it makes the toys you already paid for actually behave like one continuous intelligence. The "next-gen" feel comes from continuity + memory + standing orders + uncertainty discipline, not more models.

If you want to ship the smallest version that delivers the "whoa, it remembers me" moment: build Phase 1 only. Heartbeat in Phase 2 is what makes it feel alive between sessions. Everything past that is polish.

Approve and we build Phase 1 as previously scoped: identity layer, memory/goal/standing-order tools, confidence discipline, `model_calls` logging, additive `MemorySettings` panels.
