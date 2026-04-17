
## GHL coverage audit

### Endpoints in the GHL edge function but NOT exposed as chat tools (gaps to fix)
1. `get_conversation` — fetch a single conversation thread
2. `get_invoice` — fetch a single invoice
3. `get_opportunity` — fetch a single opportunity
4. `get_social_post` — fetch a single scheduled social post
5. `edit_social_post` — modify a scheduled social post
6. `update_link` — edit a tracking/short link
7. `import_courses` — bulk import courses
8. `create_appointment` — booking is currently routed through `book_appointment`; the raw `create_appointment` action is unexposed (minor — covered)

### What's missing from the GHL function entirely (should be added next)
These are commonly used GHL v2 endpoints not implemented at all:
- **Notes/Tasks updates**: `update_contact_note`, `delete_contact_note`, `update_contact_task`, `complete_contact_task`, `delete_contact_task`
- **Opportunity lifecycle**: `delete_opportunity`, `update_opportunity_status`
- **Calendar groups & resources**: `list_calendar_groups`, `list_calendar_resources`, `block_calendar_slot`
- **Conversations**: `update_message_status` (mark read/unread), `upload_attachment`
- **Workflows**: `remove_from_workflow`
- **Forms**: `upload_form_file`
- **Custom fields**: `create_custom_field`, `update_custom_field`, `delete_custom_field`
- **Custom values**: `create_custom_value`, `update_custom_value`, `delete_custom_value`
- **Tags (location)**: `create_tag`, `delete_tag`
- **Users**: `get_user`, `create_user`, `update_user`
- **Locations**: `get_location`, `update_location`
- **SaaS / Sub-accounts**: `list_locations` (agency view)
- **Snapshots**: `list_snapshots`
- **Payments**: `get_order`, `get_transaction`, `list_subscriptions`, `get_subscription`
- **Products**: `list_prices`, `create_price`, `update_price`
- **Media**: `upload_media_file`, `delete_media_file`

### Plan (two surgical edits, no UI/redesign)

**Edit 1 — `supabase/functions/chat/index.ts`**
Wire the 8 unexposed-but-already-implemented actions as chat tools (one-line tool defs + routing entries). Zero new HTTP code, just exposes what's already there. Highest ROI, ~10 min of edits.

**Edit 2 — `supabase/functions/gohighlevel/index.ts` + `chat/index.ts`**
Add the missing endpoint coverage above in priority order:
- **Tier A (do now)**: opportunity status update + delete, contact note/task update/delete/complete, conversation upload_attachment, workflow remove
- **Tier B (later)**: custom fields/values CRUD, tags create/delete, calendar groups/resources, users CRUD
- **Tier C (skip unless asked)**: SaaS/agency, snapshots, payments subscriptions, prices, media upload

I recommend shipping **Edit 1 + Tier A** in this pass — it closes the obvious gaps without bloating the tool list (tool count matters for model performance).

### Files touched
- `supabase/functions/chat/index.ts` — add ~13 tool definitions + routing
- `supabase/functions/gohighlevel/index.ts` — add ~9 new action cases

### Verify after
1. Ask "show me opportunity {id}" → returns single opportunity
2. Ask "delete that note" after creating one → completes
3. Ask "mark opportunity won" → status updates
4. Ask "remove contact from workflow X" → succeeds

Approve and I'll ship Edit 1 + Tier A.
