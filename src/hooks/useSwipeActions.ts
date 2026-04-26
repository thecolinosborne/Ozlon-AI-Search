import { useRef, useState, type TouchEvent } from "react";

interface UseSwipeActionsOptions {
  /** Triggered when user swipes right past the threshold */
  onSwipeRight?: () => void;
  /** Triggered when user swipes left past the threshold */
  onSwipeLeft?: () => void;
  /** Distance in px the user must drag before action fires (default 80) */
  threshold?: number;
}

/**
 * useSwipeActions — lightweight horizontal swipe handling for list rows.
 *
 * Returns spread-able handlers + the live drag offset so the caller can
 * render a colored action indicator beneath the row.
 *
 * Usage:
 *   const swipe = useSwipeActions({ onSwipeRight: handleDone });
 *   <div {...swipe.handlers} style={{ transform: `translateX(${swipe.offset}px)` }} />
 */
export function useSwipeActions({
  onSwipeRight,
  onSwipeLeft,
  threshold = 80,
}: UseSwipeActionsOptions) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const locked = useRef<"horizontal" | "vertical" | null>(null);
  const [offset, setOffset] = useState(0);

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    locked.current = null;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (startX.current === null || startY.current === null) return;
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;

    // Lock direction once the user has moved enough — prevents fighting with
    // the vertical scroll container.
    if (!locked.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      locked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }
    if (locked.current === "vertical") return;

    // Damping for nicer feel beyond threshold
    const damped = Math.abs(dx) > threshold ? Math.sign(dx) * (threshold + (Math.abs(dx) - threshold) * 0.4) : dx;
    setOffset(damped);
  };

  const onTouchEnd = () => {
    if (locked.current === "horizontal") {
      if (offset >= threshold && onSwipeRight) onSwipeRight();
      else if (offset <= -threshold && onSwipeLeft) onSwipeLeft();
    }
    setOffset(0);
    startX.current = null;
    startY.current = null;
    locked.current = null;
  };

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
    offset,
    isSwiping: locked.current === "horizontal",
  };
}
