# Fix ClickUp first

## Goal
Restore ClickUp task actions reliably and stop them from breaking when auth/session state shifts.

## What I found
- The current session is resolving as one backend user, while the saved ClickUp connection belongs to a different backend user.
- A failed refresh-token recovery happened in the preview, which likely pushed the app into the wrong auth state before ClickUp calls ran.
- The ClickUp function is then correctly returning “not connected” for the current user, even though another user record still has the saved ClickUp key.

## Plan
1. **Stabilize auth recovery on the frontend**
   - Make the auth bootstrap treat stale refresh tokens as an explicit signed-out reset instead of leaving the app in a half-broken state.
   - Ensure integration state is only hydrated after a valid session is confirmed.

2. **Harden ClickUp identity resolution in the backend**
   - Add targeted logging and stricter checks in the ClickUp function so it clearly distinguishes:
     - no authenticated user
     - authenticated user with no ClickUp connection
     - authenticated user with connection row but no stored secret
   - Prevent ambiguous fallback behavior from masking identity mismatches.

3. **Repair the current ClickUp connection path safely**
   - Verify whether the intended active user should own the existing ClickUp connection.
   - If needed, migrate or recreate the connection record for the correct authenticated user without weakening per-user isolation.

4. **Validate end-to-end**
   - Test from the frontend integration screen and through the chat/tool path.
   - Confirm ClickUp connect, test connection, and task creation all work under the same user identity.

## Technical notes
- I will only touch the auth/session flow and the ClickUp integration path for this pass.
- I will not bundle Search Console or YouTube into this fix until ClickUp is fully stable.
- If the current broken state comes from duplicate user identities, I’ll fix the resolution path first and then clean up the connection ownership safely rather than adding hacks.