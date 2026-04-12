

# Full-Spectrum Maton Skills Testing and SSE Parser Fix

## Problem
1. **SSE parser bug** (the reason "you can't even pull emails"): In `src/services/chatService.ts` line 265-268, when a JSON chunk is split across SSE frames, the `catch` block does `break` which **discards all remaining lines** in that batch. Long responses (email listings, tool call results) frequently trigger this, causing the stream to stall or lose data.

2. **No systematic validation** that all 83 Maton-connected tools work end-to-end.

## Fix 1: SSE Parser (the critical bug)

In `src/services/chatService.ts`, lines 265-269, change:
```typescript
// BEFORE (broken)
} catch {
  buffer = line + '\n' + buffer;
  break;
}

// AFTER (fixed)
} catch {
  if (trimmedLine.startsWith('data: ')) {
    buffer = trimmedLine + '\n' + buffer;
  }
  // Continue processing remaining lines instead of breaking
}
```

This single change fixes email pulling, trashing, and all other long-response tool calls.

## Fix 2: End-to-End Maton Skills Testing

After deploying the parser fix, run a systematic curl-based test of the chat edge function exercising key Maton tool categories. This validates the full pipeline: frontend SSE parsing -> edge function -> tool dispatch -> Maton gateway -> response.

### Test matrix (executed via `supabase--curl_edge_functions`):

| Category | Tool | Test prompt |
|----------|------|-------------|
| **Email Read** | `list_emails` | "Show my latest 5 emails" |
| **Email Detail** | `get_email` | "Show me the full content of email {id}" |
| **Email Trash** | `trash_email` | "Trash email {id}" |
| **Email Batch** | `batch_trash_emails` | "Trash these emails: {id1},{id2}" |
| **Calendar** | `create_calendar_event` | "Create a test event tomorrow at 3pm" |
| **Drive** | `search_google_drive` | "Search my Drive for test files" |
| **Docs** | `create_google_doc` | "Create a doc called Test" |
| **Sheets** | `create_google_sheet` | "Create a sheet called Test" |
| **GSC** | `gsc_list_sites` | "List my Search Console sites" |
| **ClickUp** | `list_clickup_tasks` | "List my ClickUp tasks" |

Each test will verify:
- The edge function returns a valid SSE stream
- Tool calls are properly dispatched and return `success: true/false` with meaningful messages
- Error cases return structured failure messages (not unhandled throws)

### Test approach
1. Apply the SSE parser fix
2. Use `curl_edge_functions` to send test prompts directly to the chat function
3. Verify each response contains proper tool call results
4. For the email trash flow specifically: list emails -> pick one -> trash it -> verify it's gone

## Files changed
- `src/services/chatService.ts` — fix SSE parser catch block (lines 265-269)
- No edge function changes needed (trash handlers already fixed)

