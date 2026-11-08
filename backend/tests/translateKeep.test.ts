import { describe, expect, test } from "bun:test";
import { translateItems, type Completer } from "../src/lib/translate/core";
import { findKeepSpans } from "../src/lib/translate/keep";

function queue(replies: string[]): Completer {
  return async () => ({ ok: true, text: replies.shift() ?? "[]" });
}

describe("translation keep terms", () => {
  test("restores fixed terms, technical values, and caller terms", async () => {
    const result = await translateItems({
      items: ["MaiPai Wi-Fi SRT https://example.com a@b.com Song Name"], from: "en", to: "es", kind: "lyric", keep: ["Song Name"],
      completer: async (messages) => {
        const source = JSON.parse(messages[1]!.content) as string[];
        return { ok: true, text: JSON.stringify(source) };
      },
    });
    expect(result.results).toEqual(["MaiPai Wi-Fi SRT https://example.com a@b.com Song Name"]);
  });

  test("Home is ordinary in lyrics and fixed in UI", async () => {
    const identity: Completer = async (messages) => ({ ok: true, text: JSON.stringify(JSON.parse(messages[1]!.content)) });
    const lyric = await translateItems({ items: ["take me Home"], from: "en", to: "es", kind: "lyric", completer: identity });
    expect(lyric.results).toEqual(["take me Home"]);
    const ui = await translateItems({ items: ["take me Home"], from: "en", to: "es", kind: "ui", spot: false, completer: identity });
    expect(ui.results).toEqual(["take me Home"]);
    const sent: string[] = [];
    await translateItems({ items: ["take me Home"], from: "en", to: "es", kind: "lyric", completer: async (messages) => { sent.push(messages[1]!.content); return { ok: true, text: '["llévame Casa"]' }; } });
    expect(sent[0]).toContain("take me Home");
  });

  test("lost marker retries singly then reports failed", async () => {
    let n = 0;
    const result = await translateItems({ items: ["MaiPai hello"], from: "en", to: "es", kind: "ui", spot: false, completer: async () => {
      n += 1;
      return { ok: true, text: '["Hola"]' };
    } });
    expect(n).toBe(2);
    expect(result.results).toEqual([null]);
    expect(result.failed).toEqual([0]);
  });

  test("spotting drops absent candidates and reports protected source terms", async () => {
    const run = async (answer: string) => translateItems({ items: ["Use Quasar now"], from: "en", to: "es", kind: "doc", completer: queue([JSON.stringify([answer]), '["Usa ⟦K1⟧ ahora"]']) });
    const absent = await run("NotInSource");
    expect(absent.newTerms).toEqual([]);
    const present = await run("Quasar");
    expect(present.newTerms).toEqual(["Quasar"]);
    expect(present.results).toEqual(["Usa Quasar ahora"]);
  });

  test("finder avoids sentence-first proper-noun guesses", () => {
    expect(findKeepSpans("Make it easy. Press Save.", [], { acronyms: false })).toEqual([]);
  });

  test("console output never contains source item text", async () => {
    const text = "sensitive item phrase";
    const calls: unknown[][] = [];
    const originals: [typeof console.log, typeof console.info, typeof console.warn, typeof console.error] = [console.log!, console.info!, console.warn!, console.error!];
    console.log = (...args: unknown[]) => { calls.push([0, ...args]); originals[0](...args); };
    console.info = (...args: unknown[]) => { calls.push([1, ...args]); originals[1](...args); };
    console.warn = (...args: unknown[]) => { calls.push([2, ...args]); originals[2](...args); };
    console.error = (...args: unknown[]) => { calls.push([3, ...args]); originals[3](...args); };
    try {
      await translateItems({ items: [text], from: "en", to: "es", kind: "chat", completer: async () => ({ ok: true, text: '["frase"]' }) });
      expect(JSON.stringify(calls)).not.toContain(text);
    } finally {
      [console.log, console.info, console.warn, console.error] = originals;
    }
  });
});

describe("keep finder paths and spotting", () => {
  test("and/or is not a path, a real path is kept", () => {
    expect(findKeepSpans("Use this and/or that", [], { acronyms: false })).toEqual([]);
    expect(findKeepSpans("Open ./docs/user/songs.md now", [], { acronyms: false })).toContain("./docs/user/songs.md");
  });
});
