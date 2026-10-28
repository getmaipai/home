import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PageContext as SpecPageContext } from "@maipai/spec/gen/ts/page-context.js";
import type { AppEntry } from "@/shell/appCatalog";

export type AmbientPageContext = SpecPageContext;
export type AmbientPageEnrichment = Pick<AmbientPageContext, "record_kind" | "record_id" | "title">;

export function ambientPageContextForRoute(pathname: string, catalog: readonly AppEntry[]): AmbientPageContext {
  const entry = [...catalog].sort((a, b) => b.to.length - a.to.length).find((app) => pathname === app.to || pathname.startsWith(`${app.to}/`));
  const routeBase = entry?.to ?? `/${pathname.split("/").filter(Boolean)[0] ?? "home"}`;
  const appId = routeBase.startsWith("/apps/") ? routeBase.slice("/apps/".length) : routeBase.slice(1) || "home";
  return { app_id: appId, route: pathname };
}

const AmbientPageContextState = createContext<{ context: AmbientPageContext; setEnrichment(value: AmbientPageEnrichment | null): void } | null>(null);

export function AmbientPageContextProvider({ base, children }: { base: AmbientPageContext; children: ReactNode }) {
  const [enrichment, setEnrichment] = useState<AmbientPageEnrichment | null>(null);
  const setCurrent = useCallback((next: AmbientPageEnrichment | null) => setEnrichment((previous) => {
    if (previous === null || next === null) return previous === next ? previous : next;
    const keys = ["record_kind", "record_id", "title"] as const;
    return keys.every((key) => previous[key] === next[key]) ? previous : next;
  }), []);
  const context = useMemo(() => ({ ...base, ...(enrichment ?? {}) }), [base, enrichment]);
  const value = useMemo(() => ({ context, setEnrichment: setCurrent }), [context, setCurrent]);
  return <AmbientPageContextState.Provider value={value}>{children}</AmbientPageContextState.Provider>;
}

export function useAmbientPageContext(): AmbientPageContext | undefined {
  return useContext(AmbientPageContextState)?.context;
}

export function useSetPageContext(context: AmbientPageEnrichment | null): void {
  const value = useContext(AmbientPageContextState);
  if (!value) throw new Error("Ambient page context is unavailable outside the app shell.");
  const set = value.setEnrichment;
  const recordKind = context?.record_kind;
  const recordId = context?.record_id;
  const title = context?.title;
  const cleared = context === null;
  useEffect(() => {
    set(cleared ? null : { record_kind: recordKind, record_id: recordId, title });
    return () => set(null);
  }, [cleared, recordKind, recordId, set, title]);
}
