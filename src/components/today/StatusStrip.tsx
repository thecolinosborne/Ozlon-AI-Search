import { useEffect, useState } from "react";
import { dayModeLabel, getDayMode, shortClock, type DayMode } from "@/lib/today/dayMode";
import type { CapacityLabel } from "@/lib/today/capacity";

interface StatusStripProps {
  capacityLabel?: CapacityLabel;
  dayMode?: DayMode;
}

/**
 * A single muted line under the Now Line.
 * "Morning · 8:42 AM · Steady day"
 * Tiny, no icons, no tooltips — calm.
 */
export function StatusStrip({ capacityLabel = "Steady day", dayMode }: StatusStripProps) {
  const [clock, setClock] = useState(() => shortClock());
  const [mode, setMode] = useState<DayMode>(() => dayMode ?? getDayMode());

  useEffect(() => {
    const tick = () => {
      setClock(shortClock());
      if (!dayMode) setMode(getDayMode());
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [dayMode]);

  return (
    <p className="mt-3 text-[11px] tracking-[0.06em] text-muted-foreground/60">
      {dayModeLabel(mode)} · {clock} · {capacityLabel}
    </p>
  );
}
