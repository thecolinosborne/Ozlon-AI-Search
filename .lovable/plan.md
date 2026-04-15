

## Remove Webhook + AI Reply Settings from ClickUp Detail

The Webhook and AI Reply Settings sections will be removed from the ClickUp integration page. The backend defaults (auto-reply enabled, mention-only trigger, standard detail) will continue to work as-is — no backend changes needed.

### Changes

**File: `src/pages/integrations/ClickUpDetail.tsx`**

1. Remove the entire **Webhook Status** card (lines ~230–265) — the webhook is already registered and doesn't need UI management
2. Remove the entire **AI Reply Settings** card (lines ~267–350) — Auto-Reply toggle, Trigger Mode, Reply Detail, Allow Subtask Creation, Allow Task Updates
3. Remove unused imports: `Webhook`, `Zap`, `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` (if no longer used elsewhere — the List Picker still uses Select)
4. Remove the `config` state, `defaultConfig`, `triggerModes`, `replyModes` constants, and the `updateConfigField` function since nothing references them anymore
5. Keep the config fetch in `useEffect` only if needed for other purposes — otherwise simplify to just the connection check

### What remains on the page
- API Token input
- Default List picker (Browse Workspace)
- Quick Actions (Fetch Tasks, Create Test Task)

### No backend changes
The backend keeps its current defaults and webhook handler intact — this is purely a frontend cleanup.

