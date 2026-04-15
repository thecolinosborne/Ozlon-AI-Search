# YouTube Integration V1 Contract

## Goal
Enable users to connect YouTube from the Integration Hub, validate credentials, and run read-safe sync jobs before enabling publish/write actions.

## Integration Hub UX Contract
1. User selects **YouTube** in Integrations.
2. User chooses auth method:
   - OAuth2 (recommended)
   - API Key (read-only metadata use cases)
3. User clicks **Connect**.
4. Backend validates credentials and upserts `integration_connections`.
5. User can run **Sync Now**:
   - creates row in `integration_sync_runs` with status `queued`
   - worker updates run lifecycle `running -> succeeded/failed/partial`
6. Hub displays:
   - status
   - last sync time
   - last error
   - sync run history

## Backend Data Model
- `public.integration_connections`
  - one row per provider/account/auth mode
  - references secure secret by `credential_ref`
  - no raw secret values stored in table
- `public.integration_sync_runs`
  - append-only operational run log
  - captures job lifecycle, counts, and error details

## Edge Function Actions (proposed)
- `youtube/connect`
- `youtube/disconnect`
- `youtube/test_connection`
- `youtube/sync_channels`
- `youtube/sync_videos`
- `youtube/list_sync_runs`

## Security Rules
- never return raw credentials to client
- store secrets in backend-managed secret vault
- keep browser store limited to non-sensitive status fields
- require explicit confirmation for write operations (publish/update/delete)

## Recommended V1 Scope
- Connect
- Validate
- List channels
- List latest videos
- Sync read-only metadata into local tables

## Out of Scope for V1
- Video upload/publish
- Comment moderation actions
- Token migration/rotation UI
- ClickUp integration changes (managed separately and intentionally untouched)
