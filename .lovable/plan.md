

## Build: Routing Attribution Chip

Surgical, additive. One file changes (plus one tiny helper). Zero backend work — the data is already flowing via `message.provider`.

## What gets built

A small pill rendered under each assistant message in `MessageBubble.tsx`, between the existing timestamp row and the action buttons:

```
✨ Gemini 2.5 Flash · your key · 1.2s   [↻ if fallback]
```

Click the chip → shadcn `Popover` opens with routing details.

## Visual spec

**Chip (default state):**
- Pill: `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full`
- Background: `bg-muted/40 hover:bg-muted/60 border border-border/30`
- Text: `text-[10px] text-muted-foreground/80`
- Provider icon: 10px Lucide glyph (Sparkles for Gemini, Bot for OpenAI, generic Cpu fallback)
- `your key` segment: `text-emerald-500/90` (green = user saved cost)
- `ozlon` segment: `text-muted-foreground/60` (muted = gateway fallback)
- Latency: muted, formatted `1.2s` (≥1000ms) or `340ms` (<1000ms)
- Fallback indicator: trailing `↻` in `text-amber-500/90` when `provider.fallback_used === true`

**Popover content (on click):**
- Header: full model ID (e.g. `gemini-2.5-flash`)
- Row: **Routed via** — `Your API key` or `Ozlon gateway`
- Row: **Mode** — Speed / Balanced / Quality (from `provider.routing_mode`)
- Row: **Why** — `provider.reason` text
- Row: **Latency** — `1240ms`
- Row: **Cost** — if `provider.cost_estimate` present, format as `$0.0023` else hide
- Conditional block: **Fallback chain** — if `provider.fallback_used`, render each entry from `provider.fallback_chain[]` as `Model X ❌ → Model Y ✅` with the failure reason in muted text
- Conditional block: **Tools used** — if `message.toolsUsed?.length`, list each tool name (replaces need for a separate tool chip)

## Files touched

**1. `src/lib/modelLabels.ts`** (new, ~30 lines)
- Export `getModelLabel(id: string): { name: string; provider: "openai" | "google" | "anthropic" | "xai" | "deepseek" | "mistral" | "unknown" }`
- Map: `gemini-2.5-flash` → `"Gemini 2.5 Flash"`, `gpt-5` → `"GPT-5"`, etc. Falls back to the raw ID with provider="unknown".
- Export `getProviderIcon(provider): LucideIcon` — Sparkles for google, Bot for openai, etc.

**2. `src/components/chat/MessageBubble.tsx`** (edit)
- Import `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover`
- Import `getModelLabel`, `getProviderIcon` from `@/lib/modelLabels`
- After the timestamp row (around line 90), add a conditional render: `{!isUser && message.provider && <RoutingChip provider={message.provider} toolsUsed={message.toolsUsed} />}`
- Define `RoutingChip` as a small inline component (or co-located in same file) that builds the pill + popover

**Untouched:** `useChatStream.ts` (already captures `provider` and `toolsUsed`), backend, `Message` type (provider field already exists per the hook).

## Type safety

`Message` in `src/types/index.ts` doesn't currently have `provider` / `toolsUsed` fields, but `useChatStream`'s `ChatMessage` type does. Verify the chat page maps inflight `ChatMessage` → display `Message` and forwards those fields. If it strips them, add `provider?: ProviderUsedEvent` and `toolsUsed?: ToolUsedInfo[]` to the `Message` interface as optional fields (additive, no breakage).

## Verification

1. Send a chat message → chip appears under the assistant reply with model name, key source, latency.
2. Click the chip → popover opens with reason + mode.
3. Switch routing budget to Speed → next message's chip shows a flash-tier model.
4. Kill personal OpenAI key → chip shows `↻` and popover renders the fallback chain.
5. Send a message that triggers a tool (e.g. "check my emails") → tools listed in popover.
6. User messages have NO chip (only assistant).

## Outcome

Every assistant turn becomes self-documenting routing proof. The Brain page audit log gains a per-message peer inside the conversation itself. ~80 lines, one real file edit, no backend or schema changes.

