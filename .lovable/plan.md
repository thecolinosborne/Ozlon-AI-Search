

## End-to-End Wisdom Integration Test

I'll drive the preview as the signed-in user, ingest a distinctive source, ask a related question, verify the `KnowledgeChip` renders with that source cited, then unplug it and confirm the influence vanishes from the next reply.

## Test sequence

### Setup
1. `navigate_to_sandbox` → `/` to confirm auth state. If signed out, stop and ask the user to sign in (per browser auth rules — won't fill login forms without approval).

### Phase 1 — Ingest a distinctive source
2. Navigate to `/wisdom`
3. Use Add Source → Paste Text mode with a deliberately unique, identifiable text so attribution is unambiguous:
   - **Title**: "Einstein — Relativity Primer"
   - **Source/Person**: "Albert Einstein"
   - **Type**: book
   - **Body**: ~3 short paragraphs covering time dilation, the equivalence principle, and spacetime curvature (long enough to clear the 200-char minimum, distinctive enough that a generic model wouldn't phrase it the same way)
4. Click Ingest, wait for the success toast
5. Confirm the new source appears in the library list with "Plugged in" state and entry count > 0
6. Verify DB-side via `supabase--read_query`:
   ```sql
   select id, title, person, is_active, entry_count
   from knowledge_sources
   where user_id = <current> order by created_at desc limit 1;
   ```

### Phase 2 — Ask a related question (plugged in)
7. Navigate to `/` (chat)
8. Send: *"In simple terms, what does Einstein's relativity say about time dilation?"*
9. Wait for the assistant reply to finish streaming
10. **Verify**: a `KnowledgeChip` ("Drew from …") appears under the assistant message
11. Open the chip popover → confirm it lists the Einstein source with a similarity %
12. Capture screenshot of the message + open chip
13. Verify backend trace via `supabase--edge_function_logs` for `chat` filtered on `wisdom_signal` → confirm `framework_hits` / `resonant_sources` includes the new Einstein entry

### Phase 3 — Unplug and re-ask
14. Navigate back to `/wisdom`
15. Click the plug toggle on the Einstein source → confirm "Unplugged" toast and visual state change
16. Verify DB: `is_active = false` for that source row
17. Navigate to `/` and start a fresh chat session (sidebar → New) so prior context doesn't carry the Einstein framing
18. Send a near-identical question: *"Explain Einstein's view on time dilation simply."*
19. Wait for reply to finish
20. **Verify**: no `KnowledgeChip` appears (orchestration filtered out the unplugged source)
21. Capture screenshot
22. Confirm via edge function logs that `wisdom_signal.resonant_sources` no longer contains the Einstein source

### Phase 4 — Re-plug and confirm gravity returns
23. Back to `/wisdom` → toggle plug on
24. New chat → ask the same question once more → confirm chip reappears
25. Quick DB check on `recurrence_count` for the cited entry — should have ticked up across the plugged turns:
   ```sql
   select id, title, recurrence_count, last_accessed_at
   from knowledge_entries
   where source_id = <einstein_source_id>;
   ```

## Pass criteria

- Plugged: `KnowledgeChip` visible with Einstein listed, edge logs show source in `wisdom_signal`
- Unplugged: no chip on a fresh session, edge logs show empty/other resonant sources
- Re-plugged: chip returns
- `recurrence_count` increments across cited turns (gravitational compounding working)

## If something fails mid-test

- **Chip doesn't appear when plugged**: inspect `useChatStream.ts` orchestration_trace handling + `ChatMessageList.tsx` rendering, plus chat function SSE emit
- **Chip still appears when unplugged**: inspect the `is_active` filter in `chat/index.ts` wisdom queries
- **No source created**: inspect `knowledge-ingest` edge function logs
- **Auth gate**: stop and report; do not attempt to log in without explicit approval

I'll report each phase's outcome with screenshots and the actual edge-log/DB confirmations, not just UI impressions.

