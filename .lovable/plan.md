

# Descript AI Media Processing Integration

## Summary
Add Descript as a media processing execution layer via a new edge function, database table, and expanded detail page. The existing chat, AI processor, Infinity Router, memory system, and all other integrations remain untouched.

## Architecture

```text
User requests media processing
  → app generates optimized Descript prompt
  → supabase/functions/descript/index.ts (action-based)
  → Descript API (https://descriptapi.com/v1)
  → job tracked in descript_jobs table
  → results returned to app for AI analysis
```

## Secret Required (1 new)
- `DESCRIPT_API_KEY` — Descript API bearer token

## Database Migration (1 new table)

### `descript_jobs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default gen_random_uuid() |
| user_id | uuid | nullable, for future per-user tracking |
| project_id | text | Descript project ID |
| job_id | text | Descript job ID, UNIQUE |
| job_type | text | import, agent, cancel |
| status | text | default 'pending' |
| input_prompt | text | nullable |
| output_data | jsonb | nullable |
| error_message | text | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

RLS enabled, no policies (server-side only via service role).

## New Files

### 1. `supabase/functions/descript/index.ts`
Action-based proxy following the ClickUp/GHL pattern.

**Actions:**
- `test_connection` — GET /jobs to verify auth works
- `import_media` — POST /jobs/import/project_media with media URL, returns job_id, stores in descript_jobs
- `run_agent_edit` — POST /jobs/agent with project_id + AI-generated prompt, stores job
- `get_job_status` — GET /jobs/{job_id}, updates descript_jobs row
- `list_jobs` — GET /jobs, returns recent jobs
- `cancel_job` — DELETE /jobs/{job_id}
- `edit_in_descript` — POST /edit_in_descript/schema, returns launch URL for manual handoff
- `get_published_project` — GET /published_projects/{slug}

**Prompt generator helper** (inside the edge function):
```
generateDescriptPrompt(userIntent: string): string
```
Maps natural language to optimized Descript prompts:
- "make this better" → "remove filler words, improve audio quality, add captions, create highlight clips"
- "make clips for tiktok" → "create 3 short engaging clips optimized for social media"
- "clean audio" → "enhance audio quality and remove background noise"
- fallback: pass user intent directly

**Safety:** All calls use `Authorization: Bearer <DESCRIPT_API_KEY>` server-side only. Graceful error handling on all actions.

### 2. `src/pages/integrations/DescriptDetail.tsx` (replace existing placeholder)
Full detail page following ClickUp pattern with `IntegrationDetailLayout`.

Sections:
- Connection status with Test Connection button
- Recent Jobs list (fetched from edge function)
- Action buttons: Import Media (URL input), Run AI Edit (project ID + intent input), Check Job Status
- Open in Descript button (handoff)
- Info panel: "Upload media, run AI-powered editing, and retrieve processed results. Descript handles media processing while your app provides the intelligence."

Job status display showing: job_id, type, status, timestamps, errors if any.

## Modified Files

### 3. `supabase/config.toml`
Add:
```toml
[functions.descript]
verify_jwt = false
```

## What Does NOT Change
- Chat edge function — untouched
- AI Processor — untouched
- Infinity Router — untouched
- Memory system — untouched
- ClickUp integration — untouched
- All other integrations — untouched
- Integrations store — untouched (uses existing generic structure)
- App.tsx routes — already wired for `/integrations/descript`
- Integrations.tsx — already has Descript entry

## Implementation Order
1. Request `DESCRIPT_API_KEY` secret
2. Create database migration (descript_jobs table)
3. Create `supabase/functions/descript/index.ts`
4. Replace `src/pages/integrations/DescriptDetail.tsx` with full implementation
5. Update `supabase/config.toml`
6. Deploy and test edge function

