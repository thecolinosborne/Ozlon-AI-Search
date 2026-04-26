# Signals — Daily Digest Upgrade

Additive on top of the existing real-time + lookahead + tuning passes. Nothing existing is removed or refactored.

## Why
Today, `signals-synthesize` only sees `work_tasks`, cached `communications_messages` metadata, `task_events`, and Wisdom recall. It does not pull a wide cross-integration snapshot the way a daily chief-of-staff brief should. Users have to "know to ask."

## New: 4th synthesis mode — `daily_digest`

### 1. `supabase/functions/signals-synthesize/index.ts` (additive)
Add a fourth branch alongside `now`, `lookahead`, `lookahead_tick`:

- **`?mode=daily_digest`** — per-user (Bearer JWT or service role + `user_id`).
  Pulls in parallel (best-effort, each wrapped in try/catch — one failure never blocks the digest):
  - **Calendar** — today + next 24h events (already wired via `getGoogleAccessToken`).
  - **Gmail** — unread count + threads awaiting your reply >24h (metadata only via existing `google-gmail` fn, `format=metadata`, capped at 25).
  - **Slack** — unread mentions + DMs from last 24h (via existing `slack` fn, read-only).
  - **GoHighLevel** — new SMS/voicemail in last 24h (via existing `gohighlevel` fn).
  - **ClickUp** — tasks due today / overdue (via existing `clickup` fn).
  - **Plaid** — balance snapshot + spend anomalies last 24h (via existing `plaid` fn, read-only).
  - **Search Console** — 7d vs prior-7d clicks/impressions delta (via existing `google-search-console` fn).
  - **Drive** — files modified in last 24h count (via existing `google-drive` fn).
  - **Wisdom recall** — same `match_wisdom_memories` + tuning floors as `now` mode.
- Feeds the consolidated snapshot into `gauntlet-router` (`node_type=signals-daily-digest`, `cost_sensitivity=low` → OpenAI), reusing the existing `emit_moments` tool but with a digest-flavored prompt:
  - Emit up to **5** moments tagged `kind="digest"`.
  - Voice rules unchanged (≤14 word headlines, calm, no emoji, no exclamation).
  - Skip integrations that returned errors silently — note them only in `diagnostics`.
- Dedup pass uses the same `match_signal_moments` (0.82 threshold) so a digest item that duplicates a live `now` signal supersedes the older one.
- Throttle: at most one `daily_digest` run per user per 6h (checked via newest `signal_moments` with `metadata->>'mode' = 'daily_digest'`).

- **`?mode=daily_digest_tick`** — cron-gated (`x-cron-key` / `SIGNALS_CRON_KEY`, defaults to service role). Fans out to up to 100 users active in last 7d, respecting per-user timezone (target ~7am local). Reuses the existing `scheduled-routines` forwarder pattern.

### 2. Cron registration (one-time SQL via insert tool — not a migration, since URL/anon key are user-specific)
Add `signals-daily-digest-hourly` job calling `scheduled-routines?mode=signals_daily_digest_tick` once per hour at minute 13. The fan-out function decides which users are due based on local time.

### 3. `supabase/functions/scheduled-routines/index.ts` (additive)
Add a `signals_daily_digest_tick` mode that forwards to `signals-synthesize?mode=daily_digest_tick` with the cron key header.

### 4. Frontend — `src/hooks/useSignals.ts` (additive)
- Add `scanNow()` helper that invokes `signals-synthesize` with `{ mode: "daily_digest" }`, then `load()`.
- Keep all existing exports (`synthesize`, `dismissAll`, `refresh`, `respond`).

### 5. Frontend — `src/pages/Signals.tsx` (additive)
- Add a small **"Scan now"** ghost button next to **Refresh** in the existing fixed top-right action group. Calm tone, spinner while running, disabled if a scan ran in the last 6h (read from newest digest moment timestamp).
- Above the existing list, render a new **"Today"** section *only when* there are live moments with `metadata.mode === 'daily_digest'`. Same `SignalSurface` list styling — additive, no redesign.
- Empty state preserved.

### 6. `src/components/signals/SignalSurface.tsx` (additive)
- Optional `filterMode?: 'daily_digest' | 'live'` prop on the `showList` path so the page can render two grouped lists (Today / Live). Default behavior unchanged for every other call site.

## Out of scope
- No changes to `signals-feedback`, `signals-tune`, `signals-synthesize` `now` / `lookahead` modes, or any UI variant other than `page`.
- No new tables, no new RLS, no schema migration.
- No bodies of emails/messages are read — counts and metadata only, matching existing privacy posture.

## Files touched
- `supabase/functions/signals-synthesize/index.ts` *(edit — add `daily_digest` + `daily_digest_tick` branches)*
- `supabase/functions/scheduled-routines/index.ts` *(edit — add forwarder mode)*
- `src/hooks/useSignals.ts` *(edit — add `scanNow`)*
- `src/pages/Signals.tsx` *(edit — Scan now button + Today section)*
- `src/components/signals/SignalSurface.tsx` *(edit — optional `filterMode` prop)*
- One-time `pg_cron` job inserted via the insert tool

## Verification
- Hit `/signals`, press **Scan now** → digest moments appear in a "Today" group within ~10s; integrations that fail are skipped silently.
- Re-press within 6h → button disabled with tooltip ("Next scan available in Xh").
- Cron tick fires hourly; only users at ~7am local get a fresh digest.
- Existing real-time + lookahead behavior unchanged.
