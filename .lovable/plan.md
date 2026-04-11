

# Add Facebook Ads Integration (Meta Marketing API)

## Overview

Build a secure Facebook Ads integration following the existing integration patterns (Maton, GoHighLevel). The integration uses a backend edge function to proxy all Meta API calls — the frontend never touches tokens.

## 1. Add Secrets (4 secrets via `add_secret` tool)

| Secret Name | Purpose |
|---|---|
| `META_ACCESS_TOKEN` | Long-lived user/system token for Meta API |
| `META_AD_ACCOUNT_ID` | Ad account ID (without `act_` prefix) |
| `META_APP_ID` | Meta App ID |
| `META_API_VERSION` | e.g. `v21.0` |

## 2. Database Migration — `facebook_ads_cache` table

Create table with RLS scoped to `user_id`:

| Column | Type |
|---|---|
| id | uuid PK |
| user_id | uuid (NOT NULL) |
| campaign_id | text |
| campaign_name | text |
| status | text |
| objective | text |
| spend | numeric |
| impressions | bigint |
| clicks | bigint |
| cpc | numeric |
| ctr | numeric |
| reach | bigint |
| date_start | date |
| date_stop | date |
| raw_json | jsonb |
| synced_at | timestamptz |
| created_at | timestamptz |

RLS: Users can SELECT, INSERT, DELETE their own rows.

## 3. Edge Function — `supabase/functions/facebook-ads-sync/index.ts`

Actions:
- **test**: Validate env vars are set, call `/me` endpoint, return status
- **sync**: Fetch campaigns from `/act_{id}/campaigns`, fetch insights from `/act_{id}/insights`, return normalized data
- **store**: Accept normalized data, upsert into `facebook_ads_cache` using service role client

Pattern: Same CORS + env var validation as the existing `maton` edge function.

Includes retry logic (1 retry on 5xx/network errors) and structured error responses.

## 4. UI — `src/pages/integrations/FacebookAdsDetail.tsx`

Uses existing `IntegrationDetailLayout`, `IntegrationStatusBadge`, `SyncControl` components. Shows:
- Connection status badge
- Campaign count
- Last sync time
- "Run Test" button → calls edge function with `action: "test"`
- "Sync Ads Data" button → calls edge function with `action: "sync"`, then `action: "store"`

## 5. Routing & Navigation

- Add route `/integrations/facebook-ads` in `App.tsx`
- Add Facebook Ads card to `Integrations.tsx` list
- Add `facebook-ads-sync` to `supabase/config.toml` with `verify_jwt = false`

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/facebook-ads-sync/index.ts` | **New** — edge function |
| `src/pages/integrations/FacebookAdsDetail.tsx` | **New** — detail page |
| `src/pages/Integrations.tsx` | Add Facebook Ads card |
| `src/App.tsx` | Add route |
| `supabase/config.toml` | Add function config |
| Migration SQL | Create `facebook_ads_cache` table + RLS |
| 4 secrets | Added via `add_secret` tool |

