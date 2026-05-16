# Budget Trip Planner — v4 UX: "All the travel apps had a baby with AI"

Got it. The feel should be: open the chat, ask one sentence, and what comes back has the **price intelligence of Hopper**, the **photo-craft of Airbnb**, the **flight clarity of Google Flights**, the **map awareness of Kayak**, the **itinerary spine of TripIt**, and the **event sense of Resy/Eventbrite** — but everything is generated, pulled, and re-pulled live from chat. No separate page. No forms. You just talk.

## The "stolen from the best" map

| Travel app | What we steal | Where it shows up |
|---|---|---|
| **Hopper** | Price prediction, "watch / wait / buy", color-coded calendar, fare drop alerts | `PriceTrendBadge`, `BestDaysStrip`, watchlist toast |
| **Google Flights** | Price grid, duration bar, stops/airline filter chips, "best" vs "cheapest" tabs | `FlightRow`, `FlightTabs` |
| **Airbnb** | Full-bleed photo carousel, host/neighborhood story, map pin, wishlist heart | `StayCard`, `StayDetailSheet` |
| **Kayak** | Hacker fares, mixed-mode (flight+stay bundle), map view of stays | `BundleSavings`, `StayMapSheet` |
| **TripIt** | Day-by-day spine, confirmation numbers, timezone-aware times | `ItineraryDays` (on save) |
| **Booking.com** | "Only 2 left", "free cancellation", trust chips | `TrustChips` on every card |
| **Resy / Eventbrite** | What's-on-this-weekend, ticket tier, sold-out tags | `EventCard` |
| **Apple Wallet** | Hero number, glanceable, one card per trip | `TripPlanCard` shell |
| **iMessage** | Tapback-style refinements, no keyboard needed | `RefineChipsRow` |
| **iOS Photos** | Scroll-snap full-bleed carousel, page dots | `TripPhotoCarousel` |
| **iOS Mail** | Undo toast (no confirm dialogs) | `UndoToast` |
| **Apple Health** | Drag slider with haptic ticks, color zones | `BudgetAdjuster` |
| **Apple Stocks** | Sparkline + delta + arrow | `PriceSparkline` |

## What the chat actually returns

### The Trip Plan Card (one message → one Wallet-style card)

```text
┌─────────────────────────────────────┐
│ Chicago · Fri Mar 7 – Sun Mar 9     │  glanceable header
│                                     │
│      $847                           │  hero number
│      ↓ $42 vs typical · falling     │  Hopper-style trend
│                                     │
│ ●●○  flights · stay · things        │  streaming dots
├─────────────────────────────────────┤
│ ✈  AA 1423  ORD 6:40a → 8:10a       │  Google-Flights row
│    1h 30m · nonstop · $218 ↓        │
│    [photos] [seat map] [book →]     │
├─────────────────────────────────────┤
│ 🏨 Sophy Hyde Park       $189/nt   │  Airbnb-style
│    [▮▮▮▮ photo carousel ▮▮▮▮]      │
│    ★4.7 · Hyde Park · free cancel  │
├─────────────────────────────────────┤
│ 🎟  This weekend in Chicago         │
│    Bulls vs Lakers · Sat 7p · $58  │
│    Second City · Fri 8p · $32      │
├─────────────────────────────────────┤
│ [Cheaper] [Nicer] [+night] [Save]   │  iMessage tapbacks
└─────────────────────────────────────┘
```

Streaming: dots fill left-to-right as `search-flights`, `search-hotels`, `search-places` return. Card never blocks.

### The chat-as-database angle

Everything the user has ever asked, saved, or watched is queryable in chat itself:

- "what trips did I look at last month?" → renders `trip_history_artifact` (list of cards from `trip_searches` + `saved_trip_plans`)
- "which one was the cheapest?" → re-ranks the same in-memory set, no new API call
- "show me only the ones under $1k that are still falling" → filter, render
- "compare Chicago and Austin" → `trip_comparison_artifact` (side-by-side table, no re-query)
- "what did I actually spend last time I went to Miami?" → joins `trip_actuals` if present, else "I don't have receipts for that trip yet"
- "alert me if Chicago drops below $700" → `set_trip_watch` tool, confirmation chip in line

The chat is the only surface. No `/trips` page, no dashboard. The orchestrator decides whether a question is a **new search** (call tools) or a **lookup** (read from `trip_searches` / `saved_trip_plans` / `trip_watchlist` / `trip_actuals` directly).

### Bottom sheets, not pages

Tap a hotel → bottom drawer slides up: full carousel + Mapbox tile + reviews snippet + 3 deep links (Booking / Airbnb / Hotels.com). Swipe down to dismiss. Stays in the chat thread.

Tap a flight → drawer with seat map link, baggage fee row, fare history sparkline, refundable badge, "book on AA" deep link.

Tap an event → drawer with venue map, ticket tiers, "add to itinerary".

### Refine = no keyboard

Below every plan, horizontal scroll of one-tap chips. Tapping fires `refine_trip_plan` patch and re-streams just the affected pillar. Undo toast appears for 4s — no confirm modals.

Chips adapt to context:
- Over budget → `[Cheaper stay]` `[Skip car]` `[Shorter trip]`
- Under budget → `[Nicer hotel]` `[+1 night]` `[Add experience]`
- Weather bad → `[Push 1 week]` `[Indoor things]`
- Sold-out event → `[Find similar]`

### Budget Adjuster (Apple Health slider)

```text
$500 ─────●──────────── $1500
              ↑ $847
```

Drag the dot, plan re-ranks live. Color shifts green → amber → red. Haptic tick every $50 (Capacitor Haptics, web no-op). Same pattern for date nudge (±2 days) and trip-length pills (1n / 2n / 3n).

### Best-Days Strip (Hopper)

For flexible-dates trips, render a horizontal calendar strip color-coded by price:

```text
[Fri  $218] [Sat  $189] [Sun  $312] [Mon  $145 ↓]
   green       green       amber        green
```

Tap a day → re-runs that pillar only.

### Trust chips

Every card carries 2–4 inline chips with universally-readable signals: `Free cancel` · `Only 2 left` · `Refundable` · `1 bag incl.` · `★4.7 (892)` · `Falling 7d` · `Below avg`. Booking-style social proof without the spam.

## Streaming + state model

```text
user: "weekend in Chicago under $700"
        │
        ▼
plan-budget-trip
        │
        ├──► emit trip_plan_skeleton  (card appears, 3 empty pillars)
        │
        ├──► search-flights ──► emit trip_plan_patch (flight pillar fills)
        ├──► search-hotels  ──► emit trip_plan_patch (stays carousel fills)
        ├──► search-places  ──► emit trip_plan_patch (events fill)
        │
        └──► emit trip_plan_ready  (total + chips + adjuster activate)
```

Same SSE channel as today's chat artifacts. No new transport.

## What gets built (UI-only delta on top of v3 backend)

| Component | Inspiration |
|---|---|
| `TripPlanCard` | Apple Wallet pass shell |
| `TripPhotoCarousel` | iOS Photos, Airbnb |
| `TripDetailSheet` | iOS sheet, Airbnb listing |
| `FlightRow` + `FlightTabs` | Google Flights |
| `StayCard` + `StayMapSheet` | Airbnb + Kayak map |
| `EventCard` | Resy / Eventbrite |
| `PriceTrendBadge` + `PriceSparkline` | Hopper + Stocks |
| `BestDaysStrip` | Hopper calendar |
| `TrustChips` | Booking.com |
| `BundleSavings` | Kayak hacker fares |
| `BudgetAdjuster` | Apple Health |
| `RefineChipsRow` | iMessage tapbacks |
| `UndoToast` | iOS Mail |
| `TripSkeleton` | Apple Music streaming fill |
| `TripHistoryArtifact` | renders `trip_searches`/`saved_trip_plans` from chat |
| `TripComparisonArtifact` | side-by-side from in-memory set |
| `ItineraryDays` (on save) | TripIt day spine |

All render inline in `ChatMessageList.tsx` via existing `trip_plan_artifact` SSE channel.

## Interaction rules

- Single composer. Voice mic stays the largest control. Chips + slider cover 90% of follow-ups so the keyboard rarely opens.
- No modal confirms. Undo toast everywhere.
- No spinners. Skeleton fill.
- No navigation. Sheets only.
- Tap targets ≥ 44pt. Bottom 88pt reserved for thumb actions.
- Haptics on price change, save, cap-breach.
- Animations 200–300ms ease-out, respect reduced-motion.
- Dark mode native.

## Empty state teaches

First open with no trips, the chat shows 3 tappable example bubbles (iOS keyboard-suggestion pattern):

```text
"Weekend in Chicago under $700"
"Cheap beach trip in March"
"Surprise me — $1000, anywhere warm"
```

## What I'd build first (smallest slice that reads as "all of them combined")

1. `TripPlanCard` shell + streaming skeleton
2. `FlightRow` (Google Flights) + `StayCard` with `TripPhotoCarousel` (Airbnb)
3. `EventCard` (Resy)
4. `PriceTrendBadge` + `BestDaysStrip` (Hopper)
5. `TripDetailSheet` (bottom drawer for any row)
6. `RefineChipsRow` + `UndoToast`
7. `TrustChips` everywhere

That's v4.0. v4.1 adds `BudgetAdjuster` + haptics + `BundleSavings`. v4.2 adds `TripHistoryArtifact` + `TripComparisonArtifact` (chat-as-database lookups) + `ItineraryDays` on save.

## Out of scope

Booking/payment. New routes or pages. Native iOS shipping. Loyalty math beyond chip display. Currencies other than USD.

---

Approve and I'll build v4.0 on top of v3's backend plan. Or pick a subset.
