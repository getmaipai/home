import { describe, expect, test } from "bun:test";
import { translateItems, TranslateHeldError, type Completer, type Kind } from "../src/lib/translate/core";
import { isProtected, validateTranslation } from "../src/lib/translate/validate";
import { isKnownLanguage, LANGUAGES } from "../src/lib/translate/languages";

function scripted(replies: Array<string | null>, calls: { count: number }): Completer {
  return async () => {
    calls.count += 1;
    const reply = replies.shift();
    return reply === null || reply === undefined ? { ok: false } : { ok: true, text: reply };
  };
}

describe("translation core", () => {
  test("translates each kind and exposes languages", async () => {
    for (const kind of ["subtitle", "lyric", "ui", "doc", "chat"] as Kind[]) {
      const result = await translateItems({ items: ["Hello"], from: "en", to: "es", kind, completer: async () => ({ ok: true, text: '["Hola"]' }) });
      expect(result.results).toEqual(["Hola"]);
      expect(result.failed).toEqual([]);
    }
    expect(isKnownLanguage("es")).toBe(true);
    expect(isKnownLanguage("fr")).toBe(true);
    expect(LANGUAGES.es?.native).toBe("Español");
  });

  test("count mismatch retries the batch once, then falls back to individual items", async () => {
    const calls = { count: 0 };
    const result = await translateItems({ items: ["One", "Two"], from: "en", to: "fr", kind: "doc", completer: scripted(['["Un"]', '["Un"]', '["Un"]', '["Deux"]'], calls) });
    expect(calls.count).toBe(4);
    expect(result.results).toEqual(["Un", "Deux"]);
  });

  test("ui skips whole batch retry", async () => {
    const calls = { count: 0 };
    const result = await translateItems({ items: ["One", "Two"], from: "en", to: "fr", kind: "ui", completer: scripted(['["Un"]', '["Un"]', '["Deux"]'], calls) });
    expect(calls.count).toBe(3);
    expect(result.results).toEqual(["Un", "Deux"]);
  });

  test("bad JSON retries, and validation failure is reported", async () => {
    const calls = { count: 0 };
    const good = await translateItems({ items: ["Hello"], from: "en", to: "es", kind: "chat", completer: scripted(["not json", '["Hola"]'], calls) });
    expect(calls.count).toBe(2);
    expect(good.results).toEqual(["Hola"]);
    const failed = await translateItems({ items: ["Hello"], from: "en", to: "es", kind: "ui", completer: async () => ({ ok: true, text: '["\\u2014"]' }) });
    expect(failed.results).toEqual([null]);
    expect(failed.failed).toEqual([0]);
  });

  test("validation rejects em dash and placeholder mismatch", () => {
    expect(validateTranslation("Hello", `Hi ${String.fromCharCode(0x2014)}`, "ui")).toBe("em dash");
    expect(validateTranslation("Hi {name}", "Hola", "ui")).toBe("placeholders differ");
  });

  test("check holds the run and protected checks apply to catalog metadata only", async () => {
    await expect(translateItems({ items: ["Hello"], from: "en", to: "es", kind: "chat", completer: async () => ({ ok: true, text: '["Hola"]' }), check: () => "Held by age filter" })).rejects.toBeInstanceOf(TranslateHeldError);
    expect(isProtected(["src/child.ts:1"], "greeting")).toBe(true);
    const caption = await translateItems({ items: ["A child is happy."], from: "en", to: "es", kind: "subtitle", completer: async () => ({ ok: true, text: '["Un niño está feliz."]' }) });
    expect(caption.results).toEqual(["Un niño está feliz."]);
  });

  test("progress reports counts, and never carries source text", async () => {
    const progress: Array<[number, number]> = [];
    const result = await translateItems({ items: ["Secret A", "Secret B"], from: "en", to: "es", kind: "doc", batchSize: 1, completer: async () => ({ ok: true, text: '["Texto"]' }), onProgress: (done, total) => progress.push([done, total]) });
    expect(result.results).toEqual(["Texto", "Texto"]);
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });
});

describe("translateItems keeps identical output", () => {
  test("a proper noun that translates to itself is accepted", async () => {
    const completer: Completer = async () => ({ ok: true, text: JSON.stringify(["MaiPai"]) });
    const out = await translateItems({ items: ["MaiPai"], from: "en", to: "es", kind: "ui", completer });
    expect(out.results).toEqual(["MaiPai"]);
    expect(out.failed).toEqual([]);
  });
});
