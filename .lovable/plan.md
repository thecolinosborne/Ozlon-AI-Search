

# Fix Descript Integration: Auto-Detect Backend API Key

## Problem
The `DESCRIPT_API_KEY` is already configured as a backend secret, but the UI still shows an API key input and requires manual entry before showing controls. The frontend `handleSaveKey` only sets a local Zustand flag — it never actually sends the key anywhere. The real key lives server-side.

## Solution
Remove the `ApiKeyInput` component from DescriptDetail. Instead, on mount, call `test_connection` to verify the backend secret is configured. If it succeeds, auto-set status to "connected". If it fails, show an info message that the backend key needs configuration.

## Changes

### `src/pages/integrations/DescriptDetail.tsx`
- Remove `ApiKeyInput` import and usage
- Add a `useEffect` that calls `test_connection` on mount to auto-detect connection status
- If successful: set status to "connected", set apiKeyConfigured to true, update lastSync
- If failed: set status to "disconnected", show inline message "Backend API key not configured"
- Remove `handleSaveKey` function
- Always show the integration controls when status is "connected" (no manual key step needed)

### No other files change
- Edge function already reads `DESCRIPT_API_KEY` from `Deno.env`
- Integrations store already tracks status
- Config is already set

