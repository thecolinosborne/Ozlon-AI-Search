

# Fix Email Trash Error Handling in Chat Edge Function

## Changes in `supabase/functions/chat/index.ts`

### 1. `trash_email` handler (lines 1975-1984)
Wrap the `callMatonGateway` call in try/catch so thrown errors (e.g. 404) are caught and returned as structured failures instead of propagating up:

```typescript
case 'trash_email': {
  const resolved = resolveConnection(connMap, 'google-mail', accountHint, userMessage, aliasMap);
  const connId = resolved?.id;
  if (!connId) return { success: false, result: noConnError('google-mail', 'Gmail') };
  console.log(`[trash_email] Trashing message ${args.message_id} via connection ${connId} (${resolved?.email})`);
  try {
    const res = await callMatonGateway(...) as { id?: string; labelIds?: string[]; error?: { message?: string } };
    console.log(`[trash_email] Result for ${args.message_id}:`, res.error ? `ERROR: ${res.error.message}` : `OK`);
    if (res.error) return { success: false, result: `Failed to trash: ${res.error.message || JSON.stringify(res.error)}` };
    return { success: true, result: `[Using Gmail: ${resolved?.email || "default"}] Email ${args.message_id} moved to trash.` };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[trash_email] Error trashing ${args.message_id}:`, errMsg);
    return { success: false, result: `Failed to trash email ${args.message_id}: ${errMsg}` };
  }
}
```

### 2. `batch_trash_emails` handler (lines 1986-2007)
- Replace `catch { return false }` with per-item error capture
- Track failure reasons per ID
- Return `success: false` when ALL fail
- Include per-ID error details in result string

```typescript
case 'batch_trash_emails': {
  // ... resolve connection, parse IDs (unchanged) ...
  const failures: string[] = [];
  let successCount = 0;
  // Process in chunks of 10
  for (chunk of chunks) {
    await Promise.all(chunk.map(async (id) => {
      try {
        const res = await callMatonGateway(...);
        if (res.error) { failures.push(`${id}: ${res.error.message}`); }
        else { successCount++; }
      } catch (e) {
        failures.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }));
  }
  const allFailed = successCount === 0;
  const detail = failures.length ? ` (${failures.join(', ')})` : '';
  return {
    success: !allFailed,
    result: `[Using Gmail: ${resolved?.email || "default"}] Batch trash: ${successCount} trashed, ${failures.length} failed${detail}.`
  };
}
```

## No other files changed
Only the two tool handlers in `supabase/functions/chat/index.ts` are modified. No frontend, no other edge functions.

