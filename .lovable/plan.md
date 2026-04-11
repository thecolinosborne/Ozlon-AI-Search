

# Remove Facebook Ads Integration

## Changes

1. **Delete edge function** `supabase/functions/facebook-ads-sync/index.ts` and remove deployed function
2. **Delete page** `src/pages/integrations/FacebookAdsDetail.tsx`
3. **Remove from `src/pages/Integrations.tsx`** — delete the facebook-ads entry from the integrations array and the Facebook import
4. **Remove from `src/App.tsx`** — delete the FacebookAdsDetail import and route
5. **Remove from `supabase/config.toml`** — delete the `[functions.facebook-ads-sync]` block
6. **Drop database table** `facebook_ads_cache` via migration

No secrets will be removed (they can stay dormant until you revisit this).

