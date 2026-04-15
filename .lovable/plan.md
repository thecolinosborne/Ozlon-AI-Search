
Fix header auth state regression

What I found
- The header structure itself looks intact. On `/`, the top-right is always `UserMenu`, and the top-left hamburger only appears when `isAuthenticated` is true.
- `UserMenu` hides all login buttons while `authLoading` is true and only shows a tiny skeleton. If auth init gets stuck or races, the user loses the only visible way to sign in.
- `AuthContext` sets up `getSession()` before `onAuthStateChange()`. That is the wrong order for reliable session restoration and OAuth return handling, and it can cause missed auth transitions.
- I did not find evidence of a layout/z-index regression in the header itself, so this looks like an auth-state/rendering bug, not a CSS disappearance bug.

Likely root cause
- The recent auth/OAuth work made the app fall into an ambiguous auth-loading state on the published site.
- Because the header gates both controls off auth state:
  - top-right becomes a loading skeleton instead of sign-in buttons
  - top-left hamburger never appears because `isAuthenticated` never resolves true
- Result: the header looks “missing” and feels unclickable even though the markup is still there.

Implementation plan

1. Stabilize auth initialization in `src/contexts/AuthContext.tsx`
- Register `onAuthStateChange()` before calling `getSession()`.
- Make auth boot deterministic so `authLoading` always resolves.
- Add a small timeout/failsafe around initial profile loading so a slow profile query cannot strand the UI in a loading state.
- Keep session/user updates centralized and avoid duplicate state transitions.

2. Make the header resilient in `src/components/UserMenu.tsx`
- Stop using an indefinite loading skeleton as the only logged-out header state.
- Show a safe public fallback (`Sign up` / `Sign in`) once the initial auth check has resolved or timed out.
- Keep the authenticated avatar menu unchanged once a real session is present.

3. Harden the landing header behavior in `src/pages/Index.tsx`
- Ensure the header remains interactive even during auth restoration.
- Keep the hamburger tied to real authenticated state only, but make the public header usable immediately.
- Avoid any state combination where both the auth CTA and the authenticated controls disappear.

4. Correct Google sign-in flow in `src/pages/AuthPage.tsx`
- Replace direct OAuth invocation with the managed Lovable Cloud OAuth helper.
- This reduces session restore inconsistencies after OAuth redirects on the published domain.

5. Verify end-to-end
- Logged out on published site: top-right sign-in/sign-up visible and clickable.
- After sign-in: top-left hamburger appears, top-right avatar menu opens.
- Sign out: header returns to public buttons immediately.
- OAuth return path: session restores cleanly without trapping the header in loading.
- Check mobile width too, since header controls are tight.

Files to update
- `src/contexts/AuthContext.tsx`
- `src/components/UserMenu.tsx`
- `src/pages/Index.tsx`
- `src/pages/AuthPage.tsx`

No database changes expected.
