// VIDEO-SETTINGS-02 (docs/design/settings-media-2026-11-02.md section 5.1): the shell relocks the Adult lock on a route change, but a Settings tab is a
// `?tab=` query on the same route. A view that shows adult-only items calls this once; leaving it (the tab or the page) drops the proof. Relocking
// while locked does nothing.
import { useEffect, useRef } from "react";
import { useLockProof } from "@maipai/ui/src/elements/adult-lock";

export function useRelockOnLeave(): void {
  const { relock } = useLockProof();
  const latest = useRef(relock);
  latest.current = relock;
  useEffect(() => () => latest.current(), []);
}
