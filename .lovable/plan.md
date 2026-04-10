

# Integrations Hub Redesign

## Summary
Create a premium, top-level Integrations page with modular integration cards and dedicated sub-pages for each service. Remove the "Agents Coming Soon" section and demote Maton from being the main connection hub to just one integration among several.

## Architecture

```text
/integrations              → Overview grid (5 cards)
/integrations/maton        → Maton AI detail page
/integrations/gohighlevel  → GHL detail page (sub-accounts)
/integrations/descript     → Descript detail page
/integrations/higgsfield   → Higgsfield AI detail page
/integrations/ai-processor → AI Processor detail page
```

## New Files

### Reusable Components
1. **`src/components/integrations/IntegrationCard.tsx`** — Modular card with: icon/logo, name, status badge (Connected / Not Connected / Syncing / Error), last sync time, connect/disconnect button. Clickable to navigate to detail page.

2. **`src/components/integrations/IntegrationStatusBadge.tsx`** — Colored badge component for visual states (green=connected, gray=not connected, blue=syncing, red=error).

3. **`src/components/integrations/IntegrationDetailLayout.tsx`** — Shared layout for all detail pages: back nav, header with icon/status, tabs for settings/sync/account.

4. **`src/components/integrations/SyncControl.tsx`** — Reusable sync direction selector (2-way, inbound, outbound) + last sync display + manual sync button.

5. **`src/components/integrations/ApiKeyInput.tsx`** — Secure API key input with show/hide toggle, save button, validation state.

### Pages
6. **`src/pages/Integrations.tsx`** — Overview page with responsive grid of IntegrationCards for all 5 integrations.

7. **`src/pages/integrations/MatonDetail.tsx`** — Shows all Maton-connected services (fetched from existing `matonService.ts`), sync status per service, manage link. Maton is presented as one ecosystem, not the controller.

8. **`src/pages/integrations/GoHighLevelDetail.tsx`** — Sub-account switcher, per-sub-account sync status, data sync toggles (contacts, pipelines, conversations). Uses existing GHL proxy.

9. **`src/pages/integrations/DescriptDetail.tsx`** — Connected workspace info, project list placeholder, media sync settings. API key input for connection.

10. **`src/pages/integrations/HiggsFieldDetail.tsx`** — Connected account info, model/config access placeholder, usage settings.

11. **`src/pages/integrations/AIProcessorDetail.tsx`** — Provider switcher (OpenAI, Anthropic, Lovable AI), API key inputs per provider, model selector dropdown, fallback routing config (future-ready).

### Store
12. **`src/stores/useIntegrationsStore.ts`** — Zustand store for integration states: connection status, API keys (references only), sync settings, last sync timestamps. Persisted to localStorage.

## Modified Files

1. **`src/App.tsx`** — Add routes: `/integrations`, `/integrations/maton`, `/integrations/gohighlevel`, `/integrations/descript`, `/integrations/higgsfield`, `/integrations/ai-processor`.

2. **`src/pages/Settings.tsx`** — Remove the "Agents" section entirely (no more "Coming Soon"). Remove the `<MatonIntegrations />` component. Remove the old "Connections" section (Calendar/Email/Banking toggles). Add a single "Integrations" row that navigates to `/integrations`.

3. **`src/components/navigation/BottomNav.tsx`** — Add an "Integrations" nav item (Plug icon) between Chat and Settings.

## Design Direction

- Clean white/light backgrounds with subtle borders (no heavy shadows)
- Status indicators using small colored dots + text labels
- Cards use `rounded-2xl`, generous padding, hover lift effect
- Detail pages use a consistent header pattern: back arrow, integration icon, name, status badge
- Smooth page transitions via React Router
- Responsive: 2-column grid on desktop, single column on mobile
- Typography hierarchy: integration name (semibold), description (muted), status (small badge)

## What Gets Removed
- "Agents Coming Soon" section from Settings
- `<MatonIntegrations />` from Settings page (moved to its own detail page)
- Old Calendar/Email/Banking toggle connections from Settings (replaced by integration hub)

## What Stays
- All existing Maton service code (`matonService.ts`, edge function) — reused in the Maton detail page
- All existing GHL proxy code — reused in the GHL detail page
- Voice, communication mode, system name settings stay in Settings

## Technical Notes
- No database changes needed — integration state stored in Zustand with localStorage persistence
- No new edge functions — detail pages use existing `maton` and `gohighlevel` proxies
- API key management for Descript/Higgsfield are UI-only initially (placeholder for future backend secret storage)
- AI Processor page reads from existing secrets (OPENAI_API_KEY, ANTHROPIC_API_KEY, LOVABLE_API_KEY)

