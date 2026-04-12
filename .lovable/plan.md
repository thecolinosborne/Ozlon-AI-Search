

# Update AI Processor — OpenAI + Gemini Only, With Connection Verification

## Summary
Replace the provider list with only **OpenAI** and **Gemini** (the two actually connected providers), add a per-provider connection verification badge, and add the `SyncControl` component. Only `AIProcessorDetail.tsx` changes. No other files touched.

## What Changes (single file: `src/pages/integrations/AIProcessorDetail.tsx`)

### 1. Imports
Add: `useEffect` from React, `SyncControl` from integrations, `RefreshCw` from lucide-react, `supabase` client.

### 2. Replace `providers` array (lines 9–13)
```typescript
const providers = [
  { id: "openai", name: "OpenAI", description: "GPT-4.1, GPT-5, GPT-5 Mini" },
  { id: "gemini", name: "Gemini", description: "Gemini 2.5 Flash, Gemini 2.5 Pro" },
];
```

### 3. Replace `models` map (lines 15–30)
```typescript
const models = {
  openai: [
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
  ],
  gemini: [
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
};
```

### 4. Add connection verification state + on-mount check
- State: `verifiedProviders: Record<string, boolean | null>` (null = checking)
- On mount, ping the `chat` edge function with a minimal payload for each provider to confirm the backend secrets (`OPENAI_API_KEY`, `LOVABLE_API_KEY`) are working
- Show a green "Verified" dot or red "Unverified" dot next to each provider card
- Remove the `requiresKey` / `ApiKeyInput` flow entirely (keys are already configured as secrets)

### 5. Add SyncControl component
- Import and render `SyncControl` between provider cards and model picker
- Wire to the integrations store (`ai-processor` ID) for sync direction and last sync time
- "Sync Now" re-runs the verification checks

### 6. Default provider → "openai"
Change fallback from `"lovable"` to `"openai"`.

### 7. Add dev console log
```typescript
console.log('[AIProcessor] Providers:', providers.map(p => p.id), 'Verified:', verifiedProviders);
```

## What Does NOT Change
- `IntegrationDetailLayout` component
- `useIntegrationsStore` store
- `SyncControl` component
- Model selection UI logic (same iteration pattern)
- Fallback Routing section at the bottom (kept as-is)
- No other pages or files

