---
name: Always check both backend and frontend
description: When user asks to fix or verify something, check BOTH the backend (edge functions, DB) AND the frontend (chat, UI) — don't fix one side and assume the other works
type: preference
---
**Rule:** When the user asks to fix, verify, or polish anything that touches both backend and frontend (e.g., chat tools, integrations, auth, model calls), ALWAYS:
1. Check the backend side (edge functions, model calls, DB queries, tool registry)
2. Check the frontend side (chat composer, tool invocation, UI state, error display)
3. Verify the data/control flow end-to-end before claiming it's done

**Why:** The user has repeatedly caught fixes where only one side was updated, leaving the feature broken in practice. They explicitly said: "a lot of times you tend to only do one side and then you realized the other side isn't fixed."

**How to apply:** Before saying "done", confirm in the response which side(s) were touched and why the other side either already works or was also updated.
