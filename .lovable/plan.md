## Goal
Make sitemap submission work from chat for `sc-domain` properties like `sc-domain:sweetblissmedia.com` so the assistant can actually call the Search Console write action instead of saying the tool is missing.

## What’s happening
The codebase already contains `gsc_submit_sitemap`, but your live request still routed into `web_investigate` and repeated the old “Unknown tool” answer. That means the blocker is not the feature design anymore — it’s the live chat runtime path.

## Plan
1. **Verify the live chat deployment path**
   - Check whether the currently deployed `chat` function is behind the repository version.
   - Confirm the live tool registry includes `gsc_submit_sitemap` and that the sitemap prompt guidance is present at runtime.

2. **Fix the routing so sitemap requests choose GSC, not research**
   - Tighten the classifier/system guidance around phrases like “submit sitemap”, `sc-domain:`, and direct sitemap URLs.
   - Add a stronger priority rule so explicit Search Console sitemap intents cannot fall through to `web_investigate`.

3. **Validate the execution path end-to-end**
   - Test a direct call flow for `gsc_submit_sitemap({ site_url, sitemap_url })`.
   - Verify the write call reaches the Search Console integration and returns a real success/error from the upstream API rather than “Unknown tool”.

4. **Handle the likely remaining auth/scope issue cleanly**
   - If the tool exists but the connected Search Console account lacks write scope, surface that exact reconnect/scope problem instead of a fake capability gap.
   - Keep read-only tools working while making the write failure actionable.

## Expected outcome
After this, saying something like:
`submit https://sweetblissmedia.com/sitemap.xml to sc-domain:sweetblissmedia.com`
should trigger the Search Console sitemap submission tool directly.

## Technical notes
- File likely involved: `supabase/functions/chat/index.ts`
- Main suspects:
  - live edge deployment drift
  - intent/router fallback to `web_investigate`
  - missing write scope on the Search Console connection
- No frontend/UI changes are needed unless we decide to add clearer error messaging later.