## What's actually broken

I traced each "capability gap" the AI keeps reporting. The tools exist — they're being **filtered out** or **mis-called** before they reach the API. Surface-level "Unknown tool" / "422 schema" messages are misleading.

### 1. `gsc_submit_sitemap` → "Unknown tool"
The tool **is wired** (chat/index.ts lines 2614, 3351, 5426, 7634). It disappears because of the 128-tool ranker:
- The keyword map at line 8885 only matches `seo|search console|gsc|impressions|clicks` for the `gsc` bucket. A request like *"submit my sitemap"* hits no keyword, so all `gsc_*` tools drop to Tier C (score 10) and get evicted when total tool count exceeds 128.
- `RESERVED_TOOLS_BY_BUCKET` (line 8949) has a floor only for `ghl`, nothing for `gsc`. So even discoverability tools get evicted.
- Chat edge function likely also needs a redeploy since the previous edit.

### 2. `ghl_add_contact_task` → 422 "locationId should not exist; completed must be boolean"
- `__injectGHLLocation` (line 908) auto-injects `locationId` into **every** POST body. GHL's `/contacts/{id}/tasks` endpoint **rejects** that field.
- Chat handler at line 4225 never sends `completed: false`, which GHL requires as a boolean.

### 3. "Scan email → make a ClickUp task" reliability
The pieces exist (`gmail_search_messages`, `gmail_get_message`, `clickup_create_task`) but the AI doesn't reliably chain them. The keyword map doesn't promote both `gmail` and `clickup` from the same phrase, and the SEO/comms prompt blocks don't tell the model the canonical multi-tool recipe.

### 4. Ugly raw email JSON in chat responses
Earlier turns already added a formatter, but I'll verify the gmail `get_message` path doesn't fall through to the default `JSON.stringify(...).slice(0, 4000)` dump when one of the structured-result paths fails.

### 5. "Hear the custom calendar"
Not clear yet — likely means TTS should read out custom-named calendar events. I'll ask you to clarify in build (see Open question).

---

## The fix

### A. Make GSC sitemap tools un-droppable
In `supabase/functions/chat/index.ts`:

1. **Expand the GSC keyword trigger** (line 8885):
   ```
   /\b(seo|search\s*console|gsc|impressions|clicks|sitemap|index(?:ing|ed)?|crawl|robots\.txt|coverage|verified\s*site)\b/
   ```
2. **Add a reserved floor for `gsc`** in `RESERVED_TOOLS_BY_BUCKET` (line 8949):
   ```
   gsc: ['gsc_list_sites', 'gsc_list_sitemaps', 'gsc_submit_sitemap', 'gsc_delete_sitemap', 'gsc_query', 'gsc_inspect_url']
   ```
3. **Don't cache write-tool sitemap calls** — extend `READ_ONLY_PREFIXES` exclusion: explicitly exclude `gsc_submit_sitemap` and `gsc_delete_sitemap` from the `gsc_` prefix cache rule (they're writes/deletes).
4. **Re-deploy `chat`** (the last edit may not have shipped).

### B. Fix the GHL task creation
In `supabase/functions/chat/index.ts`:

1. **Skip locationId injection for endpoints that reject it.** In `__injectGHLLocation` (line 908) add a path-prefix denylist for body injection:
   - `/contacts/*/tasks` (POST/PUT)
   - `/contacts/*/notes`
   - `/contacts/*/tags`
   - `/contacts/*/workflow/*`
   - `/calendars/events/appointments/*` (PUT)
   - any path that already contains `/contacts/{id}/` — the contact already implies the location.
2. **Default `completed: false`** in `ghl_add_contact_task` handler (line 4225) unless the user provides a value.
3. **Update the tool schema** (line 1847) to document `completed?: boolean` and explain the default, so the model can override when the user says "and mark it done".

### C. Make multi-step email → ClickUp routing reliable
In `supabase/functions/chat/index.ts`:

1. **Bucket pairing keywords** at line 8875: add a phrase rule that promotes **both** `gmail` and `clickup` when the user says any of:
   - "email to task", "make a task from", "pull from email", "scan email", "from this email", "from inbox", "log this email", "track this email".
2. **Add a short recipe block** to the comms/inbox system prompt section: explicit numbered steps — *(1) `gmail_search_messages` → (2) `gmail_get_message` (full body) → (3) summarize → (4) `clickup_create_task` with subject as title, summary as description, link back to message URL*. This is the only way the model reliably chains tools.
3. **Word-choice expansion** in the keyword map for `gmail` (line 8878) to include `scan`, `pull`, `extract`, `forward`, `process` so phrases like *"scan this email"* still route to the gmail bucket.

### D. Verify email reply formatting
- Re-read the gmail `get_message` chat-side handler and confirm it always returns a clean `Subject / From / Snippet / Body (text)` block — never the raw payload.headers dump that showed up in the earlier session. Falls back to text-only extraction if `payload.parts` is missing.

### E. Verification
1. Deploy `chat` via `supabase--deploy_edge_functions`.
2. Curl `chat` with: *"submit https://sweetblissmedia.com/sitemap.xml to sc-domain:sweetblissmedia.com"* — must invoke `gsc_submit_sitemap` and return success.
3. Curl `chat` with: *"add a task 'Follow up on logo files' to contact &lt;contactId&gt;"* — must POST `{title, completed: false}` with **no** locationId.
4. Curl `chat` with: *"scan my inbox for lifestyle@myhungryworld.com about logo and branding, then create a ClickUp task with the summary"* — must chain gmail search → get → clickup create.
5. Confirm the gmail response no longer prints raw header dumps.

---

## Open question (will ask in build)

> *"we should be able to hear the custom calendar"* — do you mean (a) the TTS layer should read out events from a user-renamed/custom calendar, (b) wake-word or voice command should recognize the custom calendar name, or (c) something else? I'll ask before touching voice code.

---

## Files I'll touch

- `supabase/functions/chat/index.ts` — all five edits above (ranker keyword map, reserved floor, cache exclusion, GHL injector, handler defaults, prompt recipe).
- No new files, no schema changes, no UI changes.
