// RECENCY-02: the weather detector's rescue. Mode rescue, detector over its threshold, weather tool offered, household home
// set: a plain-text first round on a weather question is replaced by the weather tool (the place writer reads a named
// place, none means the household home). The model's own call always wins. Unlike the search rescue it works on spoken
// turns and for every age band (owner, 2026-10-21). Shadow and off never hold; no home means no scoring.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { sqlite, db } from "@/db";
import { conversationTurns, people as peopleTable } from "@/db/schema";
import { embedQueryForRecall } from "@/lib/memory";
import { setHouseholdSettingValue, invalidateScopeCache } from "@/lib/settings";
import { createEntity } from "@/lib/entities";
import { useDefaultScriptedStack, SCRIPTED_EMBED_FILE } from "./stackFixture";
import { embedModelFromFile } from "@/lib/searchAssist/embedIdentity";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { streamTurnEvents } from "@/routes/turn";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { __setSearchAssistLoaderForTests } from "@/lib/searchAssist/shadow";
import { __setWeatherHeadForTests } from "@/lib/searchAssist/weatherAssist";
import { __resetSearchAssistCountersForTests, searchAssistCounters } from "@/lib/searchAssist/counters";
import { newPersonId } from "@/lib/id";
import type { SearchAssistManifest } from "@/lib/searchAssist/weights";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

let people: BenchPeople;
let teen: BenchPeople["owner"];
const UTTERANCE = "is it going to rain";
const PLAIN = "I can't tell if it is going to rain without knowing where you are.";

async function weatherHead(threshold: number): Promise<SearchAssistManifest> {
  const q = await embedQueryForRecall("probe");
  if (!q) throw new Error("the scripted embedder is unavailable");
  const row = Array.from({ length: q.dims }, (_, i) => Math.sin(1 + i) * 0.3);
  return {
    embed: { model: embedModelFromFile(SCRIPTED_EMBED_FILE)!, dims: q.dims, preprocess: q.preprocess, prefix: "" },
    features: "alone",
    classes: ["other", "weather"],
    coef: [row],
    intercept: [0],
    thresholds: { weather: { class: "weather", value: threshold } },
    label_spec_version: "test",
    dataset_sha256: "0".repeat(64),
    bench_record: "test",
  };
}

function setHome(): void {
  const home = createEntity({ id: people.owner.id, role: "owner" }, { kind: "place", place_kind: "map", name: "Springfield", scope: "household", geo: { lat: 41.9, lon: -87.6, precision: "area", area: "Springfield", from: "search" } } as never);
  if (!home.ok) throw new Error(home.error);
  expect(setHouseholdSettingValue("household.home", (home.value as { id: string }).id).ok).toBe(true);
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
  __setWeatherHeadForTests(await weatherHead(0)); // every turn scores over
  // The search head stays out of the way: no weights, so only the weather detector can arm a hold.
  __setSearchAssistLoaderForTests(async () => ({ missing: "weights_missing" as const }));
  setHome();
  setHouseholdSettingValue("chat.search_assist", "rescue");
  // A record, so a child or teen is offered the same tools their household's model is measured with.
  setHouseholdSettingValue("chat.model_id", "qwen3-6-35b-a3b-ud-q4-k-xl");
});

afterEach(() => {
  __setWeatherHeadForTests(undefined);
  __setSearchAssistLoaderForTests(null);
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
  __resetLlmSupervisorForTests();
});

interface Script { reply?: string; call?: { name: string; args: string }; place?: string | null }

async function run(actor: BenchPeople["owner"], script: Script, opts: { spoken?: boolean; utterance?: string } = {}) {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const requests: ChatCompletionRequest[] = [];
  let mainSeen = 0;
  let callSent = false;
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (req: ChatCompletionRequest) => {
      requests.push(req);
      if ((req as { response_format?: unknown }).response_format) return JSON.stringify({ place: script.place ?? null });
      mainSeen += 1;
      return mainSeen === 1 ? (script.reply ?? PLAIN) : "Final answer from the weather.";
    },
    scriptedToolCalls: (req: ChatCompletionRequest) => {
      if (!script.call || !req.tools || req.tools.length === 0 || (req as { response_format?: unknown }).response_format) return undefined;
      if (callSent) return undefined;
      callSent = true;
      return [{ id: "call-0", type: "function" as const, function: { name: script.call.name, arguments: script.call.args } }];
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  __resetLlmSupervisorForTests();
  try {
    const stream = await runTurnNextStream(actor, "chat", opts.utterance ?? UTTERANCE, opts.spoken ? { spoken: true } : {});
    if (!stream.ok || stream.kind !== "stream") throw new Error("expected a stream result");
    const events: Array<{ type: string; text?: string; value?: unknown }> = [];
    for await (const event of streamTurnEvents(stream, actor.id)) events.push(event as { type: string; text?: string; value?: unknown });
    const done = events.find((e) => e.type === "done")?.value as { turn_id?: string } | undefined;
    const row = done?.turn_id ? db.select().from(conversationTurns).where(eq(conversationTurns.id, done.turn_id)).get() : undefined;
    const stats = row?.stats ? (JSON.parse(row.stats) as { weather_assist?: { action: string; off_reason?: string; eligible: boolean } }) : {};
    const outcomes = row?.outcomes ? (JSON.parse(row.outcomes) as Array<{ packageId: string; args?: Record<string, unknown> }>) : [];
    const writerRequests = requests.filter((r) => (r as { response_format?: unknown }).response_format);
    const deltaText = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    // The call as the model is shown it again in the phrasing round: the assistant turn that carries the rescued call.
    const rescuedArgs = requests.flatMap((r) => (r.messages as Array<{ role: string; tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }> }>).flatMap((m) => (m.tool_calls ?? []).filter((c) => c.function.name === "weather").map((c) => JSON.parse(c.function.arguments) as Record<string, unknown>)))[0];
    return { action: stats.weather_assist?.action, assist: stats.weather_assist, outcomes, writerRequests, deltaText, rescuedArgs };
  } finally {
    await stub.stop();
  }
}

describe("weather rescue", () => {
  test("plain text on a weather turn is rescued with the weather tool at the household home; the held text is never shown", async () => {
    const r = await run(people.owner, {});
    expect(r.action).toBe("rescued");
    expect(r.outcomes.some((o) => o.packageId === "weather")).toBe(true);
    expect(r.rescuedArgs).toEqual({});
    expect(r.writerRequests.length).toBe(1);
    expect(r.deltaText).not.toContain("without knowing where you are");
    expect(searchAssistCounters()["weather_rescued.adult"] ?? searchAssistCounters()["search_assist.weather_rescued.adult"]).toBe(1);
  });

  test("a place the person named goes to the tool", async () => {
    const r = await run(people.owner, { place: "Denver" }, { utterance: "is it going to rain in Denver" });
    expect(r.action).toBe("rescued");
    expect(r.rescuedArgs).toEqual({ place: "Denver" });
  });

  test("it works on a spoken turn", async () => {
    const r = await run(people.owner, {}, { spoken: true });
    expect(r.action).toBe("rescued");
    expect(r.outcomes.some((o) => o.packageId === "weather")).toBe(true);
  });

  test("it works for a child and a teen", async () => {
    for (const actor of [people.child, teen]) {
      const r = await run(actor, {});
      expect(r.action).toBe("rescued");
      expect(r.outcomes.some((o) => o.packageId === "weather")).toBe(true);
    }
  });

  test("the model's own call wins: no writer, no rescue", async () => {
    const r = await run(people.owner, { call: { name: "weather", args: JSON.stringify({ place: "Boston" }) } });
    expect(r.action).toBe("declined_tool_call");
    expect(r.writerRequests.length).toBe(0);
  });

  test("under the threshold, in shadow and off, and with no home set, nothing is held", async () => {
    __setWeatherHeadForTests(await weatherHead(1));
    let r = await run(people.owner, {});
    expect(r.action ?? "none").toBe("none");
    expect(r.deltaText).toContain("without knowing where you are");
    __setWeatherHeadForTests(await weatherHead(0));
    for (const mode of ["shadow", "off"] as const) {
      setHouseholdSettingValue("chat.search_assist", mode);
      r = await run(people.owner, {});
      expect(r.action ?? "none").toBe("none");
      expect(r.deltaText).toContain("without knowing where you are");
    }
    setHouseholdSettingValue("chat.search_assist", "rescue");
    sqlite.query("DELETE FROM settings_values WHERE key = 'household.home'").run();
    invalidateScopeCache("household");
    r = await run(people.owner, {});
    expect(r.action ?? "none").toBe("none");
    expect(r.assist?.off_reason).toBe("no_home");
  });
});
