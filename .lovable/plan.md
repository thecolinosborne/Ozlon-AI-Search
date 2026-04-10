

# Comprehensive Maton Integration Fix — Subjects, Trash, and Full Tool Reliability

## Root Causes (Confirmed via Live Testing)

1. **Email subjects missing**: The Maton gateway silently drops repeated query parameters. `format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date` only returns `Date`. I tested this live — `format=full` returns all headers correctly including Subject and From.

2. **Trash not executing**: The trash API endpoint itself works (confirmed — returns TRASH label). The issue is the AI sees "(no subject)" for every email because of bug #1, making it unable to identify which emails to trash. It likely reports success prematurely or the tool loop runs out of iterations trying to work with missing data.

3. **Other services**: Calendar, Drive, Docs, Sheets, Slides all have their own connection IDs and work through Maton. Some use fallback mappings (Docs falls back to Drive connection). These are functional but need the same header fix pattern.

## Plan — Single File: `supabase/functions/chat/index.ts`

### Fix 1: Switch `fetchGmailData` from `format=metadata` to `format=full`
- Line 390: Replace `format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date` with `format=full`
- Extract From, Subject, Date from the full `payload.headers` array instead of the metadata-filtered subset
- This fixes the context injection so the AI sees real subjects in the pre-loaded inbox data

### Fix 2: Switch `list_emails` tool from `format=metadata` to `format=full`
- Line 1816: Same replacement — use `format=full` for individual message fetches
- Extract headers from the full payload
- This fixes the tool result so the AI can see subjects when listing emails via tool calls

### Fix 3: Add explicit logging to trash and batch_trash operations
- Add `console.log` before and after each trash call with message ID and connection ID
- Log the response status and whether TRASH label was applied
- This provides debugging visibility for any future trash issues

### Fix 4: Increase default `maxIterations` parameter from 5 to 10
- Line 2944: Change default parameter value from 5 to 10
- The main handler already passes 10 (line 3351), but this ensures any other callers also get a reasonable limit

### Fix 5: Add task completion summary to tool loop
- When the tool loop finishes, emit a final `task_update` with a `summary` field extracted from the AI's response
- Update `TaskUpdateEvent` interface to include optional `summary`
- Update the frontend `TaskUpdate` type and store to handle summaries
- Keep completed task bubbles visible for 15 seconds with the summary text

### Fix 6: Frontend — Add summary support to task activity
- `src/services/chatService.ts`: Add `summary?: string` to `TaskUpdate` interface
- `src/stores/useTaskActivityStore.ts`: Add `summary` field to `ActiveTask`, add `setTaskSummary` action
- `src/components/TaskActivityBubble.tsx`: Show summary text, extend auto-dismiss to 15s for completed tasks with summaries, add manual dismiss
- `src/pages/Index.tsx`: Handle summary in `onTaskUpdate` callback

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Fix `format=metadata` → `format=full` in 2 places, add trash logging, increase maxIterations default, emit task summary |
| `src/services/chatService.ts` | Add `summary` to `TaskUpdate` |
| `src/stores/useTaskActivityStore.ts` | Add summary field and setter |
| `src/components/TaskActivityBubble.tsx` | Show summary, 15s dismiss, manual dismiss |
| `src/pages/Index.tsx` | Handle summary in onTaskUpdate |

## Testing Plan (Live)
After deploying, I will:
1. Call the chat function with "colin@ozlon.net show me my latest emails" and verify subjects appear
2. Call with "trash the first email from my ozlon inbox" and verify the trash executes
3. Verify the task activity bubble shows a completion summary

## Result
- Email subjects will show correctly in both context injection and tool results
- Trash operations will execute reliably because the AI can now identify emails by subject
- Completed tasks will report back with a visible summary of what was done

