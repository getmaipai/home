// KS-02E: the prefix's date lines (KNOWLEDGE-SEARCH-DESIGN 3.2). The clock
// item states today, the model's cutoff and the installed library snapshot as
// data, plus one guidance sentence. A null cutoff and a missing library print
// nothing; a spoken turn gets the same data-only line.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../reset-db";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { contextNode, datesText } from "@/lib/turnMachine/nodes/context";
import type { TurnState } from "@/lib/turnMachine/contract";
import { withTurnDefaults } from "./turnStateDefaults";
import { useDefaultScriptedStack } from "../stackFixture";
import { setHouseholdSettingValue } from "@/lib/settings";
import { CATALOG } from "@/lib/modelCatalog";
import { registerSidecar, __resetSidecarsForTests } from "@/lib/sidecars";
import { KIWIX_SIDECAR_ID } from "@/lib/kiwixSidecar";
import { __resetReferenceReaderCachesForTests } from "@/lib/retrieval/referenceReader";
import { articleHtml, startFakeKiwix, type FakeKiwix } from "../support/fakeKiwix";

const SIGNAL = new AbortController().signal;
const CHAT_ID = "qwen3-8b-instruct-q4-k-m";
const WIKI = "wikipedia_en_all_mini_2026-09";

let people: BenchPeople;
let kiwix: FakeKiwix | null = null;
const record = CATALOG.find((m) => m.role === "chat" && m.id === CHAT_ID)!;
const originalCutoff = record.model_cutoff;

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
  useDefaultScriptedStack();
  __resetReferenceReaderCachesForTests();
  setHouseholdSettingValue("chat.model_id", CHAT_ID);
});

afterEach(() => {
  kiwix?.stop();
  kiwix = null;
  __resetSidecarsForTests();
  record.model_cutoff = originalCutoff;
});

function startKiwix(): void {
  kiwix = startFakeKiwix([{ id: WIKI, date: "2026-09-14", articles: { A: { title: "A", html: articleHtml({ title: "A", lead: ["A is a letter."] }) } } }]);
  registerSidecar({ id: KIWIX_SIDECAR_ID, command: ["true"], port: Number(new URL(kiwix.baseUrl).port) });
}

async function clockText(spoken = false): Promise<string> {
  const state = withTurnDefaults({ actor: people.owner, surface: "chat", conversationId: "", spoken } as TurnState);
  const { output } = await contextNode(state, { utterance: "hi" }, SIGNAL);
  const clocks = output.items.filter((item) => item.source === "clock");
  expect(clocks).toHaveLength(1);
  expect(clocks[0]!.disclosure).toBe("child_ok");
  return clocks[0]!.text;
}

describe("KS-02E: the prefix's three date lines", () => {
  test("all three facts and the guidance sentence print when the cutoff and the library are known", async () => {
    record.model_cutoff = "2025-06-30";
    startKiwix();
    const text = await clockText();
    expect(text).toContain("Today is ");
    expect(text).toContain("Your training ends around June 30, 2025.");
    expect(text).toContain("The home library's Wikipedia snapshot is September 14, 2026.");
    expect(text).toContain("Your own knowledge is reliable for well-known, stable facts; the reference library confirms specifics; the web is for anything that may have changed since your training.");
    // CF-SEARCH-01: a live-state question is searched, not answered from memory.
    expect(text).toContain("is looked up with the search tool before you answer, never answered from memory.");
    expect(text).not.toContain("The model's training knowledge may be older than today.");
  });

  test("RECENCY-01: a claim about something recent is looked up first, never denied from memory", () => {
    const text = datesText({ now: new Date("2026-10-10T12:00:00Z"), locale: "en-US", modelCutoff: null, librarySnapshot: null });
    expect(text).toContain("a recent event you do not recognize is more likely missing from your training than untrue");
    expect(text).toContain("never tell them they are mistaken without having searched");
    expect(text.split("\n")).toHaveLength(2);
  });

  test("RECENCY-02: a set household home adds one plain line with the place name; no home adds nothing", () => {
    const base = { now: new Date("2026-10-10T12:00:00Z"), locale: "en-US", modelCutoff: null, librarySnapshot: null };
    const withHome = datesText({ ...base, homePlace: "Springfield" });
    expect(withHome).toContain("The household home is Springfield. For weather, or \"near me\", with no place named, use it, and do not mention it unless the person asks.");
    expect(withHome.split("\n")).toHaveLength(3);
    expect(withHome).not.toMatch(/\b(brief|briefly|concise|short|shorter|sentences?|words|voice|speak|say|tone|persona)\b/i);
    expect(datesText({ ...base, homePlace: null })).toBe(datesText(base));
    expect(datesText({ ...base, homePlace: "  " })).toBe(datesText(base));
  });

  test("a null model_cutoff prints no cutoff text", async () => {
    record.model_cutoff = undefined;
    startKiwix();
    const text = await clockText();
    expect(text).not.toContain("training ends");
    expect(text).toContain("The home library's Wikipedia snapshot is September 14, 2026.");
  });

  test("no installed library prints no snapshot text", async () => {
    record.model_cutoff = "2025-06-30";
    const text = await clockText();
    expect(text).not.toContain("snapshot");
    expect(text).toContain("Your training ends around June 30, 2025.");
  });

  test("a spoken turn gets the same line, data only: no answer-length or voice instruction", async () => {
    record.model_cutoff = "2025-06-30";
    startKiwix();
    const spoken = await clockText(true);
    expect(spoken.replace(/Today is [^.]*\./, "")).toBe((await clockText(false)).replace(/Today is [^.]*\./, ""));
    expect(spoken).not.toMatch(/\b(brief|briefly|concise|short|shorter|sentences?|words|voice|speak|say|tone|persona)\b/i);
  });

  test("datesText with both unknown is today plus the guidance sentence only", () => {
    const text = datesText({ now: new Date("2026-10-10T12:00:00Z"), locale: "en-US", modelCutoff: null, librarySnapshot: null });
    expect(text.split("\n")).toHaveLength(2);
    expect(text).not.toContain("training ends");
    expect(text).not.toContain("snapshot");
  });

  test("IMG-REPLY-LEAK-01: the date line says it is reference only, not to be stated unasked", () => {
    const text = datesText({ now: new Date("2026-10-10T12:00:00Z"), locale: "en-US", modelCutoff: null, librarySnapshot: null });
    expect(text).toContain("The date and time are for your reference only: do not state them unless the person asks.");
  });
});
