import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runTrivia, checkedOpenTdbHost, __resetTriviaForTests } from "@/lib/triviaSource";
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PersonRow } from "@/types";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { runPlugin } from "@/lib/plugins";
import { __setPackageFetchForTests } from "@/lib/packageHost";

const manifest = PackageManifest.parse(JSON.parse(readFileSync(resolve(import.meta.dir, "../packages/trivia/manifest.json"), "utf8")));
const credit = manifest.data_sources?.find((row) => row.id === "opentdb")?.attribution ?? "";
const actor = (id: string, role: "child" | "teen" | "adult" = "adult") => ({ id, role }) as PersonRow;
const rng = () => 0;
const childText = new Set((JSON.parse(readFileSync(resolve(import.meta.dir, "../packages/trivia/bank.json"), "utf8")) as { questions: Array<{ band: string; question: string; answer: string }> }).questions.filter((q) => q.band === "child").map((q) => `${q.question} The answer: ${q.answer}.`));
function open(question: string, answer: string) { return async (capture: (q: { question: string; answer: string; id: string }) => void) => { capture({ question, answer, id: question }); return { actions: [], reply: { text: `${question} The answer: ${answer}.`, speech: `${question} ... The answer: ${answer}.` } }; }; }

beforeEach(() => __resetTriviaForTests());

describe("trivia source gate", () => {
  test("child never invokes the OpenTDB recipe and only gets a child bank question", async () => {
    const fail = async () => { throw new Error("fetch must not run"); };
    for (let i = 0; i < 200; i++) {
      const result = await runTrivia(actor("child-one"), "child", manifest, fail, () => (i % 199) / 199);
      expect(result?.reply?.text).toBeTruthy();
      expect(childText.has(result?.reply?.text ?? "")).toBe(true);
    }
  });
  test("runPlugin child path never reaches the package fetch stub", async () => {
    let calls = 0;
    __setPackageFetchForTests(async () => { calls++; throw new Error("child must not make a request"); });
    try {
      const result = await runPlugin("trivia", actor("real-child", "child"), {});
      expect(result.ok).toBe(true);
      expect(calls).toBe(0);
    } finally { __setPackageFetchForTests(null); }
  });
  test("child remains bank-only when the network is down", async () => {
    const expected = await runTrivia(actor("child-seed"), "child", manifest, async () => { throw new Error("fetch must not run"); }, rng);
    let called = false;
    const result = await runTrivia(actor("child-two"), "child", manifest, async () => { called = true; throw new Error("offline"); }, rng);
    expect(called).toBe(false); expect(result?.reply?.text).toBe(expected?.reply?.text);
  });
  test("teen blocks classifier flagged content and credits a clean OpenTDB reply", async () => {
    const flagged = "I want to kill myself";
    expect(checkSafety(`${flagged} answer`, { isMinor: true }).flagged).toBe(true);
    const blocked = await runTrivia(actor("teen-one"), "teen", manifest, open(flagged, "answer"), rng);
    expect(blocked?.reply?.text).not.toContain(flagged);
    expect(blocked?.reply?.text).not.toContain(credit);
    const clean = await runTrivia(actor("teen-two"), "teen", manifest, open("Which planet is largest?", "Jupiter"), rng);
    expect(clean?.reply?.text).toContain(credit);
    expect(clean?.reply?.speech).toContain(credit);
  });
  test("adult OpenTDB failures use the bank and a good reply carries its credit", async () => {
    const clean = await runTrivia(actor("adult-one"), "adult", manifest, open("Which planet is largest?", "Jupiter"), rng);
    expect(clean?.reply?.text).toContain(credit);
    for (const callback of [async () => { throw new Error("down"); }, async () => { throw new HostError("network_unreachable", "Open Trivia Database returned HTTP 429"); }, async (capture: (q: { question: string; answer: string }) => void) => { capture({ question: "", answer: "" }); return { actions: [], reply: { text: "bad", speech: "bad" } }; }]) {
      const result = await runTrivia(actor("adult-two"), "adult", manifest, callback, rng);
      expect(result?.reply?.text).toBeTruthy(); expect(result?.reply?.text).not.toContain(credit);
    }
    for (const body of [{ response_code: 5, results: [] }, { response_code: 1, results: [] }]) {
      const result = await runTrivia(actor(`response-${body.response_code}`), "adult", manifest, async (capture: (q: { question: string; answer: string; id: string }) => void) => {
        const host = checkedOpenTdbHost({ fetch: async () => body } as never, capture);
        await host.fetch("https://opentdb.com/api.php?amount=1&type=multiple");
        return { actions: [], reply: { text: "unreachable", speech: "unreachable" } };
      }, rng);
      expect(result?.reply?.text).toBeTruthy(); expect(result?.reply?.text).not.toContain(credit);
    }
    const invalidJson = await runTrivia(actor("invalid-json"), "adult", manifest, async (capture: (q: { question: string; answer: string; id: string }) => void) => {
      const host = checkedOpenTdbHost({ fetch: async () => { throw new SyntaxError("invalid JSON"); } } as never, capture);
      await host.fetch("https://opentdb.com/api.php?amount=1&type=multiple");
      return { actions: [], reply: { text: "unreachable", speech: "unreachable" } };
    }, rng);
    expect(invalidJson?.reply?.text).toBeTruthy(); expect(invalidJson?.reply?.text).not.toContain(credit);
    const http429 = await runTrivia(actor("http-429"), "adult", manifest, async (capture: (q: { question: string; answer: string; id: string }) => void) => {
      const host = checkedOpenTdbHost({ fetch: async () => new Response("rate limited", { status: 429 }) } as never, capture);
      await host.fetch("https://opentdb.com/api.php?amount=1&type=multiple");
      return { actions: [], reply: { text: "unreachable", speech: "unreachable" } };
    }, rng);
    expect(http429?.reply?.text).toBeTruthy(); expect(http429?.reply?.text).not.toContain(credit);
  });
  test("no immediate bank repeat for one person and histories are independent", async () => {
    const personA = actor("history-a"), personB = actor("history-b");
    const draws = [];
    for (let i = 0; i < 10; i++) draws.push(await runTrivia(personA, "child", manifest, async () => { throw new Error(); }, rng));
    expect(new Set(draws.map((r) => r?.reply?.text)).size).toBe(10);
    const firstB = await runTrivia(personB, "child", manifest, async () => { throw new Error(); }, rng);
    expect(firstB?.reply?.text).toBe(draws[0]?.reply?.text);
  });
  test("history forgets the oldest person after 64 active people", async () => {
    const first = actor("evicted-person");
    const before = await runTrivia(first, "child", manifest, async () => { throw new Error(); }, rng);
    for (let i = 0; i < 64; i++) await runTrivia(actor(`other-${i}`), "child", manifest, async () => { throw new Error(); }, rng);
    const after = await runTrivia(first, "child", manifest, async () => { throw new Error(); }, rng);
    expect(after?.reply?.text).toBe(before?.reply?.text);
  });
  test("an empty bank returns the ordinary no-question failure shape", async () => {
    const { resolvePackageDir } = await import("@/lib/packageResolve");
    const { writeFileSync } = await import("node:fs");
    const bankPath = resolve(resolvePackageDir("trivia"), "bank.json");
    const original = readFileSync(bankPath, "utf8");
    try {
      writeFileSync(bankPath, JSON.stringify({ version: 1, reviewed: { by: "pending", on: null }, questions: [] }));
      __resetTriviaForTests();
      const result = await runPlugin("trivia", actor("empty-bank", "child"), {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result).toMatchObject({ status: 502, code: "no_question" });
    } finally {
      writeFileSync(bankPath, original);
      __resetTriviaForTests();
    }
  });
});
