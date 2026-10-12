// ROUTER-BUILD-01d: the search assist's shadow step in the turn path. A
// child or teen is never scored and never embedded for it; the stored row
// carries a number and closed names, never the utterance; the reply is
// byte-identical with the step on and off.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { sqlite, db } from "@/db";
import { conversationTurns, people as peopleTable } from "@/db/schema";
import * as llm from "@/lib/llm";
import { embedQueryForRecall } from "@/lib/memory";
import { setHouseholdSettingValue } from "@/lib/settings";
import { useDefaultScriptedStack, SCRIPTED_EMBED_FILE } from "./stackFixture";
import { embedModelFromFile, stackEmbedModel, __setStackEmbedModelReaderForTests } from "@/lib/searchAssist/embedIdentity";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { createBenchPeople, startRecordingProxy, type BenchPeople } from "../scripts/bench/conversationRunner";
import { runSearchAssistShadow, __setSearchAssistLoaderForTests } from "@/lib/searchAssist/shadow";
import { __resetSearchAssistCountersForTests, searchAssistCounters, SEARCH_ASSIST_COUNTER_NAMES } from "@/lib/searchAssist/counters";
import { RULES } from "@/lib/ruleNames";
import { newPersonId } from "@/lib/id";
import type { SearchAssistManifest } from "@/lib/searchAssist/weights";
import type { EligibilityState } from "@/lib/searchAssist/eligible";

let people: BenchPeople;
let teen: BenchPeople["owner"];
let embedSpy: ReturnType<typeof spyOn<typeof llm, "embed">>;

const UTTERANCE = "who won the quokka marathon yesterday";

async function manifestForStubSpace(): Promise<SearchAssistManifest> {
  const q = await embedQueryForRecall("probe");
  if (!q) throw new Error("the scripted embedder is unavailable");
  const row = (seed: number) => Array.from({ length: q.dims }, (_, i) => Math.sin(seed + i) * 0.3);
  return {
    embed: { model: embedModelFromFile(SCRIPTED_EMBED_FILE)!, dims: q.dims, preprocess: q.preprocess, prefix: "" },
    features: "alone",
    classes: ["no_tool", "recency", "stable"],
    coef: [row(1), row(2), row(3)],
    intercept: [0, 0, 0],
    thresholds: { websearch: { class: "recency", value: 0.3 } },
    label_spec_version: "test",
    dataset_sha256: "0".repeat(64),
    bench_record: "test",
  };
}

beforeEach(async () => {
  resetDb();
  useDefaultScriptedStack();
  __resetSearchAssistCountersForTests();
  people = createBenchPeople();
  const id = newPersonId();
  const now = new Date().toISOString();
  sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Indigo', 'teen', 'seedseedseed', 'bench', 0, ?, ?, 'h')").run(id, now, now);
  teen = db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()!;
  const manifest = await manifestForStubSpace();
  __setSearchAssistLoaderForTests(async () => manifest);
  embedSpy = spyOn(llm, "embed");
});

afterEach(() => {
  embedSpy.mockRestore();
  __setSearchAssistLoaderForTests(null);
  __setToolOfferOverridesForTests(null);
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
  __resetLlmSupervisorForTests();
});

function eligibilityState(actor: BenchPeople["owner"], over: Record<string, unknown> = {}): EligibilityState & { surface: "chat"; actor: BenchPeople["owner"]; speakerEvidence: null } {
  return {
    surface: "chat", actor, speakerEvidence: null, spoken: false, bare: false, crisis: false,
    budget: { tools_offered: ["websearch"] }, planBasis: { surfaceClass: "written" }, outcomes: [], ...over,
  } as never;
}

describe("runSearchAssistShadow", () => {
  test("a child and a teen are never scored and never cost an embed", async () => {
    for (const actor of [people.child, teen]) {
      embedSpy.mockClear();
      const out = await runSearchAssistShadow(eligibilityState(actor), UTTERANCE, undefined);
      expect(out.eligible).toBe(false);
      expect(out.p_rounded).toBeNull();
      expect(out.action).toBe("none");
      expect(out.off_reason).toBe("gate_not_allow");
      expect(embedSpy).not.toHaveBeenCalled();
    }
    expect(searchAssistCounters()["search_assist.skipped_band.child"]).toBe(1);
    expect(searchAssistCounters()["search_assist.skipped_band.teen"]).toBe(1);
  });

  test("a minor with a recall vector is scored with band-keyed counters; without one it is not scored and makes no embed", async () => {
    const ok = { gateAllows: true, webOn: true };
    const vec = await embedQueryForRecall(UTTERANCE);
    embedSpy.mockClear();
    __resetSearchAssistCountersForTests();
    setHouseholdSettingValue("chat.search_assist", "rescue");
    const missing = await runSearchAssistShadow(eligibilityState(people.child), UTTERANCE, undefined, ok);
    expect(missing).toEqual({ mode: "shadow", eligible: false, bucket: "none", p_rounded: null, action: "none", off_reason: "no_recall_vector" });
    expect(embedSpy).not.toHaveBeenCalled();
    expect(searchAssistCounters()["search_assist.skipped_band.child"]).toBe(1);
    const blocked = await runSearchAssistShadow(eligibilityState(people.child), UTTERANCE, vec, { gateAllows: true, webOn: false });
    expect(blocked.off_reason).toBe("web_off_for_mode");
    if (vec) {
      const scored = await runSearchAssistShadow(eligibilityState(teen), UTTERANCE, vec, ok);
      expect(scored.mode).toBe("shadow");
      expect(scored.action).toBe("none");
      expect(embedSpy).not.toHaveBeenCalled();
    }
    // Numbers and closed names only: no key carries text, an id or a hash.
    for (const key of Object.keys(searchAssistCounters())) expect(key).toMatch(/^search_assist\.[a-z_]+(\.(child|teen|adult))?$/);
  });

  test("mode off embeds nothing and records only off", async () => {
    setHouseholdSettingValue("chat.search_assist", "off");
    const out = await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, undefined);
    expect(out).toEqual({ mode: "off", eligible: false, bucket: "none", p_rounded: null, action: "none", off_reason: "mode_off" });
    expect(embedSpy).not.toHaveBeenCalled();
    expect(searchAssistCounters()["search_assist.off"]).toBe(1);
  });

  test("an adult turn reuses the recall vector: a number, no extra embed", async () => {
    const recall = await embedQueryForRecall(UTTERANCE);
    embedSpy.mockClear();
    const out = await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, recall);
    expect(embedSpy).not.toHaveBeenCalled();
    expect(out.eligible).toBe(true);
    expect(typeof out.p_rounded).toBe("number");
    expect(out.action).toBe("none");
    expect(searchAssistCounters()["search_assist.scored"]).toBe(1);
  });

  test("no recall vector (a temporary chat) takes exactly one extra embed", async () => {
    embedSpy.mockClear();
    const out = await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, undefined);
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(typeof out.p_rounded).toBe("number");
  });

  // ROUTER-BUILD-01h: the Stack names the embed role "embed" on every response; the model is the file its embed process runs.
  test("the role alias on a vector never decides the model: the Stack's reported file does", async () => {
    const q = await embedQueryForRecall("x");
    expect(q!.space).toBe("embed");
    const m = await manifestForStubSpace();
    expect(m.embed.model).toBe(embedModelFromFile(SCRIPTED_EMBED_FILE)!);
    let asked: { model?: string } | undefined;
    __setSearchAssistLoaderForTests(async ({ expected } = {}) => { asked = expected; return m; });
    const ok = await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, q);
    expect(asked?.model).toBe("scripted-embed.Q4_K_M");
    expect(ok.off_reason).toBeUndefined();
    expect(typeof ok.p_rounded).toBe("number");
  });

  test("a Stack that swaps its embed model is embed_mismatch even though the alias is unchanged", async () => {
    const m = await manifestForStubSpace();
    __setSearchAssistLoaderForTests(async () => m);
    __setStackEmbedModelReaderForTests(async () => "some-newer-embedder.Q8_0");
    const out = await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, await embedQueryForRecall("x"));
    expect(out.off_reason).toBe("embed_mismatch");
    expect(searchAssistCounters()["search_assist.embed_mismatch"]).toBe(1);
  });

  test("a Stack that cannot name its embed model fails open as error, without a mismatch", async () => {
    __setStackEmbedModelReaderForTests(async () => null);
    expect(await stackEmbedModel()).toBeNull();
    const out = await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, await embedQueryForRecall("x"));
    expect(out.off_reason).toBe("error");
    expect(out.eligible).toBe(true);
    expect(searchAssistCounters()["search_assist.embed_mismatch"] ?? 0).toBe(0);
  });

  test("embedModelFromFile drops the .gguf extension only", () => {
    expect(embedModelFromFile("nomic-embed-text-v1.5.Q4_K_M.gguf")).toBe("nomic-embed-text-v1.5.Q4_K_M");
    expect(embedModelFromFile(".gguf")).toBeNull();
  });

  test("missing weights, a mismatched space and a throw each fail open with a named reason", async () => {
    __setSearchAssistLoaderForTests(async () => ({ missing: "weights_missing" }));
    expect((await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, undefined)).off_reason).toBe("weights_missing");
    const m = await manifestForStubSpace();
    __setSearchAssistLoaderForTests(async () => ({ ...m, embed: { ...m.embed, model: "some-other-model" } }));
    expect((await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, await embedQueryForRecall("x"))).off_reason).toBe("embed_mismatch");
    __setSearchAssistLoaderForTests(async () => { throw new Error("boom"); });
    const out = await runSearchAssistShadow(eligibilityState(people.owner), UTTERANCE, undefined);
    expect(out.off_reason).toBe("error");
    expect(out.eligible).toBe(true);
    expect(searchAssistCounters()["search_assist.error"]).toBe(1);
  });

  test("the counter names are a closed list and the rule is named", () => {
    expect([...SEARCH_ASSIST_COUNTER_NAMES]).toEqual(["scored", "over_threshold", "rescued", "rescued_at_budget", "skipped_band", "skipped_surface", "off", "weights_missing", "embed_mismatch", "error"]);
    expect(RULES["search_assist.scored"]).toBeTruthy();
  });
});

async function turn(actor: BenchPeople["owner"], text: string) {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: () => "Here is a plain answer." });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    const result = await runTurnNext(actor, "chat", text);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    return result.value;
  } finally {
    proxy.stop();
    await stub.stop();
  }
}

function storedStats(turnId: string): Record<string, unknown> {
  const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!;
  return JSON.parse(row.stats!) as Record<string, unknown>;
}

describe("search assist in the turn path", () => {
  test("an adult written turn stores stats.search_assist with a number and no text", async () => {
    setHouseholdSettingValue("chat.search_assist", "shadow");
    const value = await turn(people.owner, UTTERANCE);
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()!;
    const stats = JSON.parse(row.stats!) as { search_assist?: Record<string, unknown> };
    // The default budget may not offer websearch; then the record still names why, with no number.
    expect(stats.search_assist).toBeDefined();
    expect(stats.search_assist!.action).toBe("none");
    expect(Object.keys(stats.search_assist!).sort()).toEqual(["action", "bucket", "eligible", "mode", "off_reason", "p_rounded"].filter((k) => k in stats.search_assist!).sort());
    // No utterance word in the stored search_assist record or the rules column.
    const serialized = JSON.stringify(stats.search_assist) + (row.rules ?? "");
    for (const word of UTTERANCE.split(" ")) expect(serialized.toLowerCase()).not.toContain(word);
    // The scripted adult budget offers websearch, so this turn must have been scored.
    expect(stats.search_assist!.eligible).toBe(true);
    expect(typeof stats.search_assist!.p_rounded).toBe("number");
    expect(JSON.parse(row.rules!)).toContain("search_assist.scored");
  });

  test("a child turn stores eligible false and requests no assist embed", async () => {
    setHouseholdSettingValue("chat.search_assist", "shadow");
    const value = await turn(people.child, UTTERANCE);
    const stats = storedStats(value.turn_id) as { search_assist?: { eligible: boolean; p_rounded: number | null; off_reason?: string } };
    expect(stats.search_assist?.eligible).toBe(false);
    expect(stats.search_assist?.p_rounded).toBeNull();
    expect(stats.search_assist?.off_reason).toBe("no_websearch");
    // Every embed the child's turn made was the memory recall's own, never a second one.
    const childEmbeds = embedSpy.mock.calls.length;
    embedSpy.mockClear();
    setHouseholdSettingValue("chat.search_assist", "off");
    await turn(people.child, UTTERANCE);
    expect(embedSpy.mock.calls.length).toBe(childEmbeds);
  });

  test("the reply is byte-identical with the step on and off", async () => {
    const outputs: string[] = [];
    for (const mode of ["off", "shadow"] as const) {
      resetDb();
      useDefaultScriptedStack();
      people = createBenchPeople();
      setHouseholdSettingValue("chat.search_assist", mode);
      const value = await turn(people.owner, "tell me a short fact about otters");
      outputs.push(JSON.stringify({ reply: value.reply, source: value.source, sources: value.sources ?? null, blocks: value.blocks ?? null, safety: { ...value.safety, checked_at: "" } }));
    }
    expect(outputs[0]).toBe(outputs[1]!);
  });
});
