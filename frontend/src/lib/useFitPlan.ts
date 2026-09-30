import { useEffect, useState } from "react";
import { api, type FitPlanResponse } from "@/lib/api";

const cache = new Map<string, Promise<FitPlanResponse>>();
type FitPlanState = { key: string | null; state: "idle" | "loading" | "ready" | "failed"; response: FitPlanResponse | null };

export function __resetFitPlanCacheForTests() {
  cache.clear();
}

export function useFitPlan(url: string | null, contextTokens: number | undefined): { state: "idle" | "loading" | "ready" | "failed"; response: FitPlanResponse | null } {
  const key = url === null ? null : JSON.stringify([url, contextTokens]);
  const [result, setResult] = useState<FitPlanState>({ key: null, state: "idle", response: null });
  useEffect(() => {
    if (url === null || key === null) {
      setResult({ key: null, state: "idle", response: null });
      return;
    }
    let promise = cache.get(key);
    if (!promise) {
      promise = Promise.resolve().then(() => api.fitPlan({ source: { url }, ...(contextTokens ? { context_tokens: contextTokens } : {}) }));
      cache.set(key, promise);
      promise.then(
        (response) => { if (response.plan === null && cache.get(key) === promise) cache.delete(key); },
        () => { if (cache.get(key) === promise) cache.delete(key); },
      );
    }
    let active = true;
    setResult({ key, state: "loading", response: null });
    promise.then(
      (response) => { if (active) setResult({ key, state: "ready", response }); },
      () => { if (active) setResult({ key, state: "failed", response: null }); },
    );
    return () => { active = false; };
  }, [url, contextTokens, key]);
  if (key === null) return { state: "idle", response: null };
  return result.key === key ? { state: result.state, response: result.response } : { state: "loading", response: null };
}
