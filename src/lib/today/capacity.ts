// Local capacity heuristic. The edge function returns its own label;
// this is the fallback while the brief is loading or unavailable.
export type CapacityLabel = "Light day" | "Steady day" | "Heavy day" | "Overloaded day";

export interface CapacityInputs {
  eventsToday: number;
  overdue: number;
  highSignals: number;
  openLoops: number;
}

export function scoreCapacity(input: CapacityInputs): CapacityLabel {
  const score =
    input.eventsToday * 1.0 +
    input.overdue * 1.5 +
    input.highSignals * 1.2 +
    input.openLoops * 0.4;
  if (score < 3) return "Light day";
  if (score < 6) return "Steady day";
  if (score < 10) return "Heavy day";
  return "Overloaded day";
}
