

## Show Connected YouTube Channel Card (Title, Thumbnail, Stats)

Right now the YouTube page shows the Channel ID as a masked string (`UCxx…xxxx`) with no way to confirm *which* channel is actually connected. The backend already validates the channel against YouTube on save (`/channels?part=snippet&id=…`) and the `sync_channels` action stores title/thumbnail/subscriber/video/view counts in the `youtube_channels` table — we're just not surfacing any of it.

Add a "Connected channel" card that pulls from the synced row and shows real channel identity, plus a clear sync state.

### Changes (1 file backend, 1 file frontend)

**1. `supabase/functions/youtube/index.ts` — extend `get_connection`**

After the existing connection lookup, when `external_account_id` (channel ID) is present, fetch the matching row from `youtube_channels` and return it on the response:

```ts
let channelInfo = null;
if (conn?.external_account_id) {
  const { data: ch } = await adminClient
    .from("youtube_channels")
    .select("channel_id, title, thumbnail_url, subscriber_count, video_count, view_count, fetched_at")
    .eq("user_id", userId)
    .eq("channel_id", conn.external_account_id)
    .maybeSingle();
  if (ch) channelInfo = ch;
}
// add to response payload:
return jsonOk({ connection, oauthStatus, grantedScopes, channelInfo });
```

No schema changes. No new RLS work. The `youtube_channels` table is already populated by the existing `sync_channels` action.

**2. `src/pages/integrations/YouTubeDetail.tsx` — render the connected channel card**

- Add `channelInfo` to component state, hydrate from `result.channelInfo` inside `loadConnectionWithRetry`.
- Above the "YouTube Data API & Channel" inputs section, render a new card **only when** `savedConn?.channelId` exists:
  - **If `channelInfo` exists** (sync ran successfully): show channel thumbnail (40px circle), title, channel ID (small, monospace, fully visible — not masked), subscriber + video + view counts, and `Last synced • ${relativeTime(channelInfo.fetched_at)}`. Add a small "Sync Now" link that calls existing `syncYouTubeData()`.
  - **If `channelInfo` is null but channel ID is set**: show amber "Channel saved but not yet synced — click Sync to fetch channel details" with a Sync button.
  - **If channel ID isn't set yet**: render nothing (existing inputs still show).
- Replace the masked Channel ID hint (`UCxx…xxxx`) under the input with the full Channel ID once configured — no value masking is needed for a public channel identifier.

### What you'll see

- After saving a valid Channel ID (and the auto-sync that already runs on save), a card appears at the top showing:
  - The actual channel **avatar + name** (e.g. "Your Channel Name")
  - Full channel ID visible
  - "1.2K subscribers • 45 videos • 320K views"
  - "Last synced 2 minutes ago" with a Sync Now control
- If sync hasn't run yet (e.g. API key missing when channel ID was saved), an amber prompt explains exactly why and offers a one-click Sync.
- The Channel ID input keeps its existing Update flow — paste a new ID, it re-validates with Google, syncs, and the card refreshes.

### Out of scope

- No new tables, RLS policies, or migrations.
- No changes to OAuth, sync_videos, upload form, or sister Google service pages.
- No changes to `googleScopes.ts`, Integrations hub, or `useIntegrationsStore`.
- No new edge function actions — purely a payload extension to `get_connection`.

### Technical notes

- `youtube_channels` rows are upserted on `(user_id, channel_id)` by `sync_channels`, so re-saving a different channel ID + sync produces a fresh row without stale data.
- `channelInfo` is null on first load until the auto-sync (which `useEffect` already triggers when `savedConn.lastSyncAt` is null) finishes — the existing 900ms-retry loop in `loadConnectionWithRetry` will pick up the synced row on its next poll.
- Channel ID is public information (visible in any YouTube channel URL) — no security reason to mask it.

