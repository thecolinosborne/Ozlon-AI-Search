
User wants a full end-to-end audit: confirm everything we've built actually works, backend↔frontend, no broken paths. This is a research/QA pass, not a feature build — but it's substantial enough to warrant a plan so the user knows the scope before I burn cycles.

## Scope: Full-stack health check

### What I'll verify

**1. Chat pipeline (the spine)**
- `/chat` edge function deploys clean (post Phase C edits)
- Tool registry returns 259 validated tools
- v2 domain gating works (sample: send "what's in my gmail" → confirm only google-workspace tools loaded)
- Streaming SSE reaches frontend, deltas render
- Auth: JWT forwarded, user_id resolved, integrations visible

**2. Phase C fixes (just shipped)**
- ClickUp `create_task` callable end-to-end
- Soft-deleted work_tasks excluded from chat context (the 3 patched queries)
- Frontend `useWorkTasks` still filters `deleted_at IS NULL` by default

**3. Integrations — connection + tool roundtrip**
For each: confirm (a) connection record exists / can be created, (b) edge function deploys, (c) at least one chat tool successfully calls it
- Google Workspace (Gmail, Calendar, Drive, Docs, Sheets, Slides) via Maton
- Google Marketing (GSC, GA4, Tag Manager, YouTube)
- GoHighLevel (Tier 3, ~50 tools)
- ClickUp (workspace discovery + create_task)
- Plaid (accounts + transactions)
- Descript / Higgsfield / image-gen / video-gen / viral-creative
- Knowledge / Wisdom (ingest + search)

**4. Auth + onboarding**
- Signup → onboarding → chat flow intact
- Signout reset (no data leak between users)
- Google OAuth still works
- AuthContext single source of truth

**5. Voice subsystem**
- Whisper transcription (transcribe fn)
- ElevenLabs TTS + OpenAI fallback (text-to-speech fn)
- Realtime voice mode (realtime-session fn)
- Voice cloning (voice-clone fn)

**6. Wisdom / Memory**
- knowledge-ingest + knowledge-search
- save_memory tool from chat
- personality-evolve + proposal inbox

**7. Database health**
- Run Supabase linter (RLS, exposed columns)
- Spot-check RLS on user_roles, profiles, work_tasks, integration_credentials
- Confirm no tables without RLS

**8. Build / runtime**
- TypeScript compiles
- Console logs clean (currently only one benign warning: "RESET_BLANK_CHECK")
- No 500s in recent edge logs

### Method
Read-only tools only (this mode):
- `code--search_files` to verify wiring across files
- `supabase--read_query` for DB state
- `supabase--linter` for security
- `supabase--edge_function_logs` for recent failures
- `supabase--analytics_query` for HTTP error rates last 24h
- `code--view` for surgical file checks

Active testing (curl edge functions, browser flows) requires default mode — I'll list any test that needs the user to run it manually OR flag it for the post-approval execution pass.

### Deliverable
A single status report with one of three marks per area:
- ✅ **PASS** — verified working
- ⚠️ **WARN** — works but has known caveat (e.g., requires user connection)
- ❌ **FAIL** — broken, with proposed fix

If FAILs are found, I'll group them and propose surgical fixes (no refactors, per stabilization policy).

### Out of scope
- No code changes during the audit
- No new features
- No Phase A file split (still deferred)
- No UI changes

### Estimated effort
~15-20 read-only tool calls. Single report at the end. Any fixes proposed get their own approval gate.

Approve and I execute the audit.
