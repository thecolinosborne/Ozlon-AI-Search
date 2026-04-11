
Fix the Maton integration in two layers: the integration UI and the chat execution path.

1. Confirm the real failure path in backend logs
- Inspect the deployed `chat` and `maton` backend logs for Google Search Console requests.
- Verify whether GSC calls are failing because of:
  - stale backend deployment
  - wrong endpoint/response shape
  - missing connection resolution
  - swallowed gateway errors returning empty data

2. Harden Maton gateway error handling
- Update the shared Maton gateway helper in `supabase/functions/chat/index.ts` so non-2xx responses throw explicit errors instead of silently returning JSON/text.
- Add GSC-specific diagnostics around:
  - site listing
  - `searchAnalytics/query`
  - empty site lists vs actual request failure
- Make the final assistant response say whether data was fetched, no sites were found, or the connection needs attention.

3. Fix Google Search Console fetch behavior
- Review the current GSC endpoints and payloads used in `fetchGSCData`.
- Adjust the fetcher to match the real gateway response format and support the connected account cleanly.
- Add fallback behavior if the first report query shape is unsupported, rather than failing the whole GSC pull.

4. Improve Maton integration screen so issues are visible
- Update the Maton detail/settings UI to surface per-connection health more clearly:
  - app name
  - account/email when available
  - active vs pending vs error
  - clearer Google Search Console labeling
- Add actionable error text instead of generic “No services connected yet” when the backend returns a failure.

5. Test end-to-end after implementation
- Open the Maton integration screen and verify Google Search Console appears as connected.
- In chat, test prompts like:
  - “pull my google search console data”
  - “show my search console performance for the last 7 days”
- Confirm the assistant returns real GSC data instead of a generic/empty answer.
- If the backend was stale, redeploy the updated function and re-test.

Technical notes
- Frontend connection loading already works: the preview network snapshot shows `functions/v1/maton` returning an ACTIVE `google-search-console` connection.
- The main gap is likely inside the deployed chat backend path, not the connection list UI.
- The current `fetchGSCData` implementation exists, but it treats empty results as “No sites found in GSC” and the shared gateway helper does not currently fail loudly on bad Maton responses, which can hide the real issue.
