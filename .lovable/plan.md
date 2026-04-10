

# Deep Dive: GoHighLevel Integration — Gap Analysis and Fix Plan

## Current State

Your GHL integration has **three layers**:

1. **GHL Proxy Edge Function** (`supabase/functions/gohighlevel/index.ts`) — supports 30 actions
2. **Chat AI Tools** (`supabase/functions/chat/index.ts`) — exposes only **11 tools** to the AI
3. **Chat `callGHL` helper** — calls the GHL API directly (not via the proxy function)

The AI can only do what's defined as a tool in the chat function. The proxy edge function has more coverage but the AI doesn't use it.

## What's Missing

### Tier 1: Already in proxy, NOT exposed as AI tools (high impact)

| Capability | Why it matters |
|---|---|
| `get_contact` — View full contact details | AI can list but can't drill into a single contact |
| `update_contact` — Edit contact fields | Can create but can't update name, email, tags, custom fields |
| `search_contacts` — Advanced search | Only has basic query filter, not the full POST-based search |
| `update_opportunity` — Move deals between stages | Can create deals but can't update status or move stages |
| `get_calendar_events` — View upcoming appointments | Can list calendars but can't see what's booked |
| `get_free_slots` — Check availability | Can book but can't check open slots first |
| `list_conversations` / `get_conversation_messages` — Read message threads | Can send messages but can't read conversation history |
| `list_invoices` / `create_invoice` — Billing | Proxy supports it, AI can't access it |
| `list_orders` / `list_transactions` — Payment data | Proxy supports it, AI can't access it |
| `list_forms` / `get_form_submissions` — Form data | Proxy supports it, AI can't access it |
| `list_funnels` — Funnel overview | Proxy supports it, AI can't access it |
| `list_custom_fields` / `list_custom_values` — CRM schema | Proxy supports it, AI can't access it |
| `list_users` — Team members | Proxy supports it, AI can't access it |
| `list_tags` — All available tags | Can add tags but can't list what tags exist |

### Tier 2: Not in proxy OR chat (GHL API v2 supports these)

| Capability | Endpoint |
|---|---|
| Delete contact | `DELETE /contacts/{id}` |
| Add/list contact notes | `POST/GET /contacts/{id}/notes` |
| Add/list contact tasks | `POST/GET /contacts/{id}/tasks` |
| Remove tags from contact | `DELETE /contacts/{id}/tags` |
| Cancel/reschedule appointment | `PUT/DELETE /calendars/events/appointments/{id}` |
| Trigger workflow for contact | `POST /contacts/{id}/workflow/{workflowId}` |
| Get funnel pages | `GET /funnels/funnel/{id}` |

### Tier 3: Advanced (lower priority, GHL API v2)

Social Planner, Blogs, Products, Courses, Surveys, Media, Companies, Links

## The Plan

### Step 1: Add ~19 missing AI tools to chat function

Expose all Tier 1 capabilities as tools the AI can call. These all use the existing `callGHL` helper — no new proxy code needed.

New tools to add:
- `ghl_get_contact` — full contact details
- `ghl_update_contact` — edit contact fields
- `ghl_search_contacts` — advanced POST-based search
- `ghl_update_opportunity` — move stage, update value/status
- `ghl_get_calendar_events` — view scheduled appointments
- `ghl_get_free_slots` — check availability before booking
- `ghl_list_conversations` — list recent conversations
- `ghl_get_conversation_messages` — read message thread
- `ghl_list_invoices` — list invoices
- `ghl_create_invoice` — create invoice
- `ghl_list_orders` — list payment orders
- `ghl_list_transactions` — list payment transactions
- `ghl_list_forms` — list forms
- `ghl_get_form_submissions` — read form responses
- `ghl_list_funnels` — list funnels
- `ghl_list_custom_fields` — view CRM schema
- `ghl_list_custom_values` — view custom values
- `ghl_list_users` — list team members
- `ghl_list_tags` — list all available tags

### Step 2: Add Tier 2 actions to both proxy AND chat

Add to the GHL proxy edge function and expose as AI tools:
- `ghl_delete_contact`
- `ghl_add_contact_note` / `ghl_list_contact_notes`
- `ghl_add_contact_task` / `ghl_list_contact_tasks`
- `ghl_remove_tags`
- `ghl_cancel_appointment`
- `ghl_trigger_workflow` — trigger a workflow for a specific contact

### Step 3: Update intent detection keywords

Add keywords for invoices, payments, transactions, forms, submissions, funnels, notes, tasks so the AI knows when to pull GHL data proactively.

## Files Changed

- **`supabase/functions/chat/index.ts`** — Add ~25 new tool definitions + execution handlers
- **`supabase/functions/gohighlevel/index.ts`** — Add ~8 new proxy actions (notes, tasks, delete contact, remove tags, cancel appointment, trigger workflow)

## What Stays the Same

- Existing 11 working tools are untouched
- `callGHL` helper stays the same
- GHL_API_KEY and GHL_LOCATION_ID secrets already configured
- Frontend code unchanged — tools are dynamically available to the AI

