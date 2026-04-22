import { useEffect, useRef, useState } from "react";

export function useScrollCollapse(threshold = 80) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      setCollapsed(el.scrollTop > threshold);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return { ref, collapsed };
}
