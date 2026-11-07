import { useEffect } from "react";

/** Marks an open article so the shell can use its compact reader header. */
export function useAppReading(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    document.documentElement.setAttribute("data-app-reading", "");
    return () => document.documentElement.removeAttribute("data-app-reading");
  }, [active]);
}
