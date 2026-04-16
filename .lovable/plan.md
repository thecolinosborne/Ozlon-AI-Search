

## Goal
Expand the YouTube upload pipeline (edge function + chat tool + UI form) to support every relevant YouTube Data API v3 publishing field, plus auxiliary calls (thumbnail, captions, playlist, pinned comment) — so users can fully publish from Ozlon chat or the form without needing YouTube Studio. **Surgical, additive only.**

## Architecture (single source of truth)

```text
┌───────────────────────────────────────────────────────────────┐
│  Chat tool: upload_youtube_video (expanded params)            │
│  Form:      YouTubeDetail.tsx → Upload panel (expanded)       │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
        supabase/functions/youtube/index.ts
        ─ upload_video (expanded snippet+status+recordingDetails)
        ─ set_thumbnail   (POST videos/thumbnails)
        ─ upload_caption  (POST captions)
        ─ add_to_playlist (POST playlistItems, supports name→id)
        ─ pin_comment     (commentThreads insert + comments setModerationStatus)
        ─ update_video    (PUT videos – metadata-only edits)
```

All five sub-actions reuse the existing OAuth refresh path. Existing `upload_video` callers stay backwards compatible (new fields are optional).

## Part 1 — Edge function `supabase/functions/youtube/index.ts`

Replace the single `upload_video` handler with an expanded one and add new actions. All additive — old params still work.

**Expanded `upload_video` params:**
- Core: `title`, `description`, `videoUrl`, `privacyStatus`
- Snippet: `tags[]`, `categoryId`, `defaultLanguage`, `defaultAudioLanguage`
- Status: `madeForKids`, `selfDeclaredMadeForKids`, `license` (`youtube`|`creativeCommon`), `embeddable`, `publicStatsViewable`, `publishAt` (ISO → forces `private` until time), `notifySubscribers` (query param)
- recordingDetails: `recordingDate`, `locationDescription`
- Post-upload chain (all optional, run sequentially after video ID returned, each wrapped in try/catch — failures returned as `warnings[]` so the upload still counts as successful):
  - `thumbnailUrl` → call `set_thumbnail` internally
  - `captionsUrl` + `captionsLanguage` + `captionsName` → `upload_caption`
  - `playlistId` OR `playlistName` → `add_to_playlist` (name resolves via `/playlists?mine=true`, creates if missing)
  - `pinnedComment` → `pin_comment`

**New actions:**
- `set_thumbnail` — `videoId`, `thumbnailUrl` (downloads + multipart POST to `/upload/youtube/v3/thumbnails/set`)
- `upload_caption` — `videoId`, `captionsUrl`, `language`, `name`, `isDraft?`
- `add_to_playlist` — `videoId`, `playlistId?`, `playlistName?`
- `pin_comment` — `videoId`, `commentText` (insert top-level comment, then `comments.setModerationStatus` with `pinned`)
- `list_playlists` — `mine=true` (used by form dropdown)
- `list_video_categories` — `regionCode` (used by form dropdown)
- `update_video` — metadata-only PUT (lets users edit after upload without re-uploading)

Description gets `hashtags[]` appended (deduped, max 15 per YT limit). `chapters[]` of `{timestamp, title}` get formatted into description (must include `00:00`).

## Part 2 — Chat tool `supabase/functions/chat/index.ts`

Expand `upload_youtube_video` tool schema (single function — keeps token budget reasonable):
- Add: `tags`, `category_id`, `made_for_kids`, `language`, `default_audio_language`, `recording_date`, `location`, `hashtags`, `chapters` (array of `{timestamp,title}`), `thumbnail_url`, `captions_url`, `captions_language`, `playlist_id`, `playlist_name`, `publish_at`, `license`, `embeddable`, `public_stats_viewable`, `notify_subscribers`, `pinned_comment`.
- Required stays minimal: `title`, `video_url`. AI suggests rather than blocks for SEO fields.
- Update handler `case 'upload_youtube_video'` to forward all fields to the youtube edge function's expanded `upload_video` action (delegate, don't duplicate logic — replaces ~100 lines with a single fetch + return), and surface returned `warnings[]` in the success message.

Add system prompt addendum (short, in existing YouTube section) with rules:
- Preserve user-provided fields verbatim.
- Suggest missing SEO fields, never block.
- No keyword stuffing; tags ≤ 15, ≤ 500 chars total.
- Confirm before publish if `privacy_status=public`.
- Auto-detect Shorts (vertical + ≤60s) and append `#Shorts` if missing.

## Part 3 — UI `src/pages/integrations/YouTubeDetail.tsx`

Expand the existing collapsible "Upload Video" panel — same component, same OAuth, just more fields organized into sub-sections:

- **Core** (existing): URL, title, description, privacy
- **SEO**: tags (chip input), category dropdown (populated from `list_video_categories`), language, default audio language
- **Schedule & Audience**: `publish_at` datetime picker, `made_for_kids` toggle, `notify_subscribers` toggle
- **Discovery**: hashtags (chip input), location, recording date
- **Content**: chapters (timestamped row editor, +/- rows), captions URL + language
- **Distribution**: playlist dropdown (from `list_playlists`) OR new playlist name input, thumbnail URL
- **Engagement**: pinned comment textarea
- **Advanced** (collapsible): license, embeddable, public stats viewable

All new fields default to empty/unchanged so the existing minimal flow still works in one click.

## Files touched
- `supabase/functions/youtube/index.ts` — expand `upload_video`, add 6 new actions
- `supabase/functions/chat/index.ts` — expand tool schema + simplify handler to delegate
- `src/pages/integrations/YouTubeDetail.tsx` — expand upload panel with grouped fields + load categories/playlists

No DB migrations, no new files, no other components touched.

