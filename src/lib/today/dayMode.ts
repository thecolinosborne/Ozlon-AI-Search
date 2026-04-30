// Time-of-day mode for the Today briefing. Pure function so it's safe in render.
export type DayMode = "morning" | "midday" | "evening";

export function getDayMode(now: Date = new Date()): DayMode {
  const h = now.getHours();
  if (h < 12) return "morning";
  if (h < 17) return "midday";
  return "evening";
}

export function dayModeLabel(mode: DayMode): string {
  if (mode === "morning") return "Morning";
  if (mode === "midday") return "Midday";
  return "Evening";
}

export function shortClock(now: Date = new Date()): string {
  let h = now.getHours();
  const m = now.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}
