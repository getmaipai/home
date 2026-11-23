import { describe, expect, test } from "bun:test";
import { runProviders, type SearchProvider } from "@/lib/search/providers";
import type { PersonRow } from "@/types";

const actor = { id: "p1" } as PersonRow;
const row = (kind: string, title: string) => ({ kind, id: title, title, href: "/x" });
const fast = (kind: string, titles: string[]): SearchProvider => ({ kind, heading: kind, search: async () => titles.map((t) => row(kind, t)) });
const never = (kind: string): SearchProvider => ({ kind, heading: kind, search: () => new Promise(() => {}) });

describe("runProviders", () => {
  test("a slow reference provider is dropped after its short timeout and own results still return", async () => {
    const started = Date.now();
    const groups = await runProviders([fast("conversation", ["Export notes"]), never("reference")], "export", actor, { timeoutMs: { reference: 50 }, defaultTimeoutMs: 500 });
    expect(Date.now() - started).toBeLessThan(400);
    expect(groups.map((g) => g.kind)).toEqual(["conversation"]);
  });

  test("a provider that throws never hides the others", async () => {
    const boom: SearchProvider = { kind: "media", heading: "Media", search: async () => { throw new Error("down"); } };
    const groups = await runProviders([boom, fast("conversation", ["Export"])], "export", actor, { timeoutMs: {}, defaultTimeoutMs: 500 });
    expect(groups.map((g) => g.kind)).toEqual(["conversation"]);
  });

  test("reference results still come after own content", async () => {
    const groups = await runProviders([fast("reference", ["Export"]), fast("conversation", ["Export"])], "export", actor, { timeoutMs: {}, defaultTimeoutMs: 500 });
    expect(groups.map((g) => g.kind)).toEqual(["conversation", "reference"]);
  });

  test("a provider that answers before its timeout is kept", async () => {
    const slowish: SearchProvider = { kind: "reference", heading: "Wikipedia", search: async () => { await new Promise((r) => setTimeout(r, 20)); return [row("reference", "Export")]; } };
    const groups = await runProviders([slowish], "export", actor, { timeoutMs: { reference: 300 }, defaultTimeoutMs: 500 });
    expect(groups.map((g) => g.kind)).toEqual(["reference"]);
  });
});
