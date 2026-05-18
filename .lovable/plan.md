## Goal

Let the assistant analyze **any public** YouTube channel (e.g. Allie Bloyd, Jasper Aiken) — not just the user's own — so it can produce competitive content strategy without scraping youtube.com directly.

## What exists today

- `supabase/functions/youtube/index.ts` already holds a YouTube Data API v3 client (`ytFetch`, key validation, OAuth + API-key paths).
- All current actions target the **signed-in user's own** channel: `sync_channels`, `sync_videos`, `upload_video`, etc. No public-channel/handle lookup.
- `chat/index.ts` exposes a YouTube context-pack reader and an `upload_youtube_video` tool — but no "analyze competitor" tool.
- `FIRECRAWL_API_KEY` is connected and used elsewhere (event research). Good for the fallback.
- A workspace `YOUTUBE_API_KEY` secret already exists for several users via the api-key integration; we'll reuse the same key resolution path. If no per-user key, fall back to a project-level `YOUTUBE_API_KEY` env var.

## Build plan

### 1. Extend `supabase/functions/youtube/index.ts` with public-channel actions

All read-only, API-key based, no OAuth required. Quota-cheap (`channels` = 1u, `playlistItems` = 1u, `videos` = 1u per batch of 50).

- `resolve_channel({ handle?, channelId?, url? })` → normalize @handle / /channel/UC... / /c/Name / youtube.com URL to a canonical `channelId` via `search.list?type=channel` (fallback) and `channels.list`.
- `get_channel_stats({ channelId })` → title, subscribers, totalViews, videoCount, uploads playlist ID, country, publishedAt, thumbnails.
- `list_channel_uploads({ channelId, max=50, order="date" })` → walk `playlistItems` on the uploads playlist, then batch `videos.list` (part=snippet,statistics,contentDetails) for views/likes/comments/duration.
- `get_top_videos({ channelId, max=25 })` → `search.list?channelId&order=viewCount` then hydrate via `videos.list`. (Costs 100u — gated behind explicit user ask.)
- `compare_channels({ channelIds: [] })` → parallel `get_channel_stats` + light upload sample, return a normalized comparison object.

Auth: accept service-role + `x-user-id` (so chat can call it server-to-server, matching existing pattern). Key resolution order: user's stored api_key connection → `Deno.env.get("YOUTUBE_API_KEY")` project secret → 400 with actionable message.

### 2. Register a chat tool `analyze_youtube_channel`

In `supabase/functions/chat/index.ts`, alongside `upload_youtube_video`:

```
analyze_youtube_channel({
  target: string,                     // @handle, channelId, or full URL
  mode: "stats" | "latest" | "top" | "compare",
  max?: number,                       // default 25, cap 50
  compareWith?: string[]              // additional targets for mode=compare
})
```

Behavior:
- Resolves each target → channelId.
- Calls the matching youtube action(s) via internal `supabase.functions.invoke('youtube', ...)` with service-role + `x-user-id`.
- Returns a compact JSON the model can summarize: `{ channel, subscribers, videos, uploads:[…], topVideos:[…], growth?:{…} }`.
- On any 4xx from the YouTube API (quota / key missing / channel not found), call the SocialBlade fallback (step 3) and tag `source: "socialblade"`.

### 3. SocialBlade-via-Firecrawl fallback

New helper in the youtube edge function: `fallback_socialblade({ handle })`.

- Firecrawl `scrape` of `https://socialblade.com/youtube/c/{handle}` (and `/user/`, `/channel/` variants) with `formats: [{ type: 'json', schema }]` so Firecrawl's LLM extraction returns: `{ subscribers, totalViews, uploads, monthlyGrowth, rank, grade, last30dViews, last30dSubs }`.
- Cache result for 6h in a new lightweight table `youtube_competitor_cache` (channel_handle, payload jsonb, fetched_at) to avoid burning Firecrawl credits on repeat questions.
- Surface results with explicit `source: "socialblade"` so the assistant cites the fallback in its reply.

### 4. Persistence (small)

Migration: `youtube_competitor_cache (id, handle text unique, channel_id text, payload jsonb, source text, fetched_at timestamptz default now())`. RLS off (service-role only writes; chat reads via edge function only — no client access).

### 5. Memory + prompt nudges

- Add a memory note at `mem://integrations/youtube-competitor-insights` describing when the tool fires (any time the user names another creator/channel), and the source-tagging convention.
- Tiny addition to the chat system prompt: "When the user asks about a public YouTube channel that isn't theirs, call `analyze_youtube_channel` — never claim a 403 / scraping limitation."

## Technical notes

- Quota budget: the default `analyze_youtube_channel({mode:"latest"})` costs ~3 units per channel (channels.list + playlistItems.list + videos.list batch). `mode:"top"` adds 100 for the search call — only run when asked.
- Re-use existing `ytFetch` error mapping so quota / key errors propagate as structured messages the chat can act on (triggers the SocialBlade fallback automatically).
- No frontend changes required — this lights up in the existing chat surface immediately. The Integrations Hub YouTube card already documents the API key flow, so no UI work needed for setup.

## Out of scope (call out, don't build)

- Per-user OAuth for private analytics (watch time, retention, demographics). Deferred until requested.
- Historical growth charts beyond what SocialBlade returns in a single scrape.
- Any UI for competitor dashboards — assistant returns analysis inline in chat.

## Acceptance check

After implementation, asking the assistant *"compare Allie Bloyd and Jasper Aiken's YouTube channels and tell me what content is working for each"* should:
1. Resolve both handles.
2. Pull stats + latest 25 uploads for each (YouTube Data API).
3. Optionally pull top videos (asks user before spending the 100u).
4. Fall back to SocialBlade if quota fails, with the source disclosed.
5. Produce a strategic readout — no 403, no "I can't access YouTube".
