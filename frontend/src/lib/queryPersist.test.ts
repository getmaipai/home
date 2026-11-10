// RELOAD-RESTORE-01
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { QUERY_PERSIST_KEY, QUERY_PERSIST_MAX_AGE_MS, restoreQueryCache, saveQueryCache } from "./queryPersist";

const memory = (): Storage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage; };
const filled = () => { const c = new QueryClient(); c.setQueryData(["widgets"], { a: 1 }); c.setQueryData(["adult-lock"], { x: 1 }); c.setQueryData(["big"], "x".repeat(70_000)); return c; };

describe("query cache restore", () => {
  test("restores the same person's small answers and leaves adult and big ones out", () => {
    const s = memory(); saveQueryCache(filled(), "p1", 1000, s);
    const fresh = new QueryClient();
    expect(restoreQueryCache(fresh, "p1", 2000, s)).toBe(true);
    expect(fresh.getQueryData<unknown>(["widgets"])).toEqual({ a: 1 });
    expect(fresh.getQueryData(["adult-lock"])).toBeUndefined();
    expect(fresh.getQueryData(["big"])).toBeUndefined();
  });
  test("another person's or an old copy is dropped", () => {
    const s = memory(); saveQueryCache(filled(), "p1", 1000, s);
    expect(restoreQueryCache(new QueryClient(), "p2", 2000, s)).toBe(false);
    expect(s.getItem(QUERY_PERSIST_KEY)).toBeNull();
    saveQueryCache(filled(), "p1", 1000, s);
    expect(restoreQueryCache(new QueryClient(), "p1", 1000 + QUERY_PERSIST_MAX_AGE_MS + 1, s)).toBe(false);
  });
});
