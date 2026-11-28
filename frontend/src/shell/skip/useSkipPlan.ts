import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SkipPlan } from "./skipPlan";

export function useSkipPlan(episodeId: string | null | undefined) {
  const [plan, setPlan] = useState<SkipPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!episodeId) { setPlan(null); setError(null); return; }
    setPlan(null);
    try { const next = await api.requestSkipPlan(episodeId); setPlan(next); setError(null); }
    catch { setPlan(null); setError("Skip plan unavailable. Playback will continue without skipping; check your connection and retry."); }
  }, [episodeId]);
  useEffect(() => { void refresh(); const listener = () => void refresh(); window.addEventListener("podcast-skip-plan-updated", listener); return () => window.removeEventListener("podcast-skip-plan-updated", listener); }, [refresh]);
  return { plan, error, refresh };
}
