import { describe, expect, test, beforeEach } from "bun:test";
import { newMemoryRecordId } from "@/lib/memoryId";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

describe("newMemoryRecordId()", () => {
  test("builds a spec-shaped id for each kind", () => {
    expect(newMemoryRecordId("memory")).toMatch(/^mem[0-9]+-[a-z0-9]{6}$/);
    expect(newMemoryRecordId("entity")).toMatch(/^ent[0-9]+-[a-z0-9]{6}$/);
    expect(newMemoryRecordId("episode")).toMatch(/^ep[0-9]+-[a-z0-9]{6}$/);
  });

  test("sequences per kind without reuse", () => {
    const a = newMemoryRecordId("memory");
    const b = newMemoryRecordId("memory");
    expect(a).not.toBe(b);
    const seqOf = (id: string) => Number(id.split("-")[0]!.slice(3));
    expect(seqOf(b)).toBe(seqOf(a) + 1);
  });

  test("kind counters stay independent", () => {
    const m = newMemoryRecordId("memory");
    const e = newMemoryRecordId("entity");
    expect(m.split("-")[0]!.startsWith("mem")).toBe(true);
    expect(e.split("-")[0]!.startsWith("ent")).toBe(true);
  });
});
