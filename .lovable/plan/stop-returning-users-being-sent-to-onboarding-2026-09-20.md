# Stop returning users being sent to onboarding

## Fix
- Treat profile lookup errors and timeouts as temporary service failures, not proof that onboarding is incomplete.
- Send an existing account to onboarding only when a successful profile lookup explicitly shows it is incomplete.
- If a returning user is already on the onboarding screen after state recovers, return them to chat automatically.

## Validation
- Test Colin's restored signed-in session on mobile.
- Confirm chat opens without onboarding, and genuine new-account onboarding remains available.
- Confirm the app builds cleanly.

## Technical details
- Keep the current authentication and profile structure unchanged.
- Make surgical changes in the shared auth state and onboarding route only.
