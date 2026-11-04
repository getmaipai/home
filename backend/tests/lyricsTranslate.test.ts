import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cachedTranslation, fillTranslation, translateLines, sourceHash } from "@/lib/music/lyricsTranslate";
import { resetDb } from "./reset-db";

describe("lyrics translation", () => {
  test("batches 18 lines and preserves order", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const sizes: number[] = [];
    const result = await translateLines(lines, "Spanish", async (_language, batch) => {
      sizes.push(batch.length);
      return batch.map((line) => `es:${line}`);
    });
    expect(sizes).toEqual([18, 2]);
    expect(result[19]).toBe("es:line 19");
  });
  test("leaves a batch untranslated after mismatch, empty answer or error", async () => {
    const lines = ["one", "two"];
    expect(await translateLines(lines, "French", async () => ["un"])).toEqual([null, null]);
    expect(await translateLines(lines, "French", async () => [])).toEqual([null, null]);
    expect(await translateLines(lines, "French", async () => { throw new Error("offline"); })).toEqual([null, null]);
  });
  test("hashes normalized source lines deterministically", () => {
    expect(sourceHash(["a", "b"])).toBe(sourceHash(["a", "b"]));
    expect(sourceHash(["a", "b"])).not.toBe(sourceHash(["a", "c"]));
  });
});

describe("lyrics translation cache", () => {
  const lines = ["Morning light", "Warm and bright"];
  beforeEach(async () => { await resetDb(); });

  test("a stored translation is served for the same lines and dropped when the lines change", async () => {
    const llm = await import("@/lib/llm");
    const spy = spyOn(llm, "complete").mockResolvedValue({ ok: true, value: { text: "1. Luz de la mañana\n2. Cálida y brillante" } } as never);
    await fillTranslation("media-1", "Spanish", lines);
    expect(cachedTranslation("media-1", "Spanish", lines)).toEqual(["Luz de la mañana", "Cálida y brillante"]);
    expect(cachedTranslation("media-1", "French", lines)).toBeNull();
    expect(cachedTranslation("media-1", "Spanish", ["Morning light", "Changed"])).toBeNull();
    expect(cachedTranslation("media-1", "Spanish", lines)).toBeNull();
    spy.mockRestore();
  });

  test("a model failure or a wrong line count stores nothing", async () => {
    const llm = await import("@/lib/llm");
    const spy = spyOn(llm, "complete").mockResolvedValue({ ok: true, value: { text: "only one line" } } as never);
    await fillTranslation("media-2", "Spanish", lines);
    expect(cachedTranslation("media-2", "Spanish", lines)).toBeNull();
    spy.mockResolvedValue({ ok: false, error: "offline" } as never);
    await fillTranslation("media-2", "Spanish", lines);
    expect(cachedTranslation("media-2", "Spanish", lines)).toBeNull();
    spy.mockRestore();
  });

  test("a translation that trips the band text check is not stored", async () => {
    const llm = await import("@/lib/llm");
    const spy = spyOn(llm, "complete").mockResolvedValue({ ok: true, value: { text: "1. porn video\n2. fine" } } as never);
    await fillTranslation("media-3", "Spanish", lines);
    expect(cachedTranslation("media-3", "Spanish", lines)).toBeNull();
    spy.mockRestore();
  });
});
