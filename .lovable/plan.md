

## Fix: Repopulate Saved YouTube Credentials + Persist Channel ID Correctly

### What's actually in your database right now

Queried your `integration_connections` row directly:

| Field | Value |
|---|---|
| `metadata.api_key` | ✅ Present (masked `***XyGY`) |
| `metadata.api_key_masked` | ✅ `***XyGY` |
| `external_account_id` (Channel ID) | ❌ **NULL** |
| `external_account_label` | `Primary YouTube` |
| `auth_type` | `oauth2` |
| OAuth scopes | ✅ All granted |

**So the answer to "is it already there?":**
- **API Key**: yes, it's saved. The page *should* already be showing "Configured ✓ ***XyGY".
- **Channel ID**: no, it was never persisted. Every save attempt for the Channel ID silently failed to write `external_account_id`.

### Two bugs to fix (1 file)

**`supabase/functions/youtube/index.ts` — `connect` action**

1. **Channel ID is being lost on save.** Walking the `connect` handler: when the user submits just a Channel ID (no new API key), the code paths that UPDATE the existing row only set `external_account_id` inside certain branches. Need to always write `external_account_id` + `external_account_label` to the row whenever `channelId` is provided and validated — independent of whether `apiKey` was also provided.

2. **API-key-only saves must not clobber OAuth tokens, and Channel-ID-only saves must not clobber the API key.** The UPDATE should merge into existing `metadata` (spread), not replace it. Verify the current code does this for all three input combinations: (apiKey only), (channelId only), (both).

Concretely, in the `connect` handler:
- Validate `apiKey` against Google only if provided (`/videos?id=dQw4w9WgXcQ`).
- Validate `channelId` against Google only if provided (`/channels?part=snippet&id=…`) — using either the newly-submitted key OR the existing stored `metadata.api_key` so channel-ID-only saves still validate.
- Build the UPDATE payload incrementally:
  - If `apiKey` given → set `metadata.api_key`, `metadata.api_key_masked`.
  - If `channelId` given → set top-level `external_account_id = channelId` and `external_account_label = accountLabel || existing`.
  - Always merge: `metadata: { ...existing.metadata, ...patch }`.
- Kick the existing auto-sync only when a channel ID is present (new or previously stored).

No changes to `get_connection` — it already correctly reads `external_account_id` and `metadata.api_key_masked`.

### Frontend

No changes needed. Once the backend persists the Channel ID correctly, `YouTubeDetail.tsx` will render:
- "YouTube Data API Key" → **Configured ✓ ***XyGY** (already works — this is already saved)
- "Channel ID" → **Configured ✓ UC…** (will work once you re-paste it and the fixed backend stores it)
- "Connected channel" card with title/avatar/stats once the auto-sync completes (already wired up).

### What you'll do after the fix ships

1. Reload `/integrations/youtube` → API Key shows **Configured ✓ ***XyGY** immediately (it was already saved).
2. Paste your Channel ID into the Channel ID field → Save. Backend validates it with Google, writes `external_account_id`, kicks auto-sync.
3. Within a few seconds the "Connected channel" card appears with your channel's avatar, title, subscriber/video/view counts, and "Last synced" timestamp.

### Out of scope

- No DB migration. No data backfill needed — your API key row stays; we're only fixing the write path for Channel ID going forward.
- No frontend changes. No OAuth changes. No sister-service changes.
- No cleanup of the other user's orphan row (different account — not yours).

### Technical notes

- The `(user_id, provider)` unique constraint guarantees one row per user — confirmed in your data.
- `api_key` presence is preserved because UPDATE always merges metadata via spread; the bug is only that `external_account_id` wasn't being written on channel-ID-only saves.
- Validation uses the cheap 1-quota `/videos` probe for key + `/channels?part=snippet&id=…` for channel ID; both surface Google's specific error reasons on failure.

