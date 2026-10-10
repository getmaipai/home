// GENUI-05: the bundled packages that already produce a visual return it as an
// answer block: remind and timer a `schedule_card`, list-view a `todo_list`
// (show_images' `image_gallery` waits for GENUI-13c). Each block is built from data the
// run already holds, is valid against the spec, goes through the same filter
// GENUI-02 applies (manifest allowlist, age band, output floor), and a block
// that fails never touches the package's reply.
import { beforeEach, describe, expect, test } from "bun:test";
import { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";
import { TurnStreamEvent as WireEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import { resetDb } from "./reset-db";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { runPlugin, loadManifestOnly } from "@/lib/plugins";
import { filterAnswerBlocks } from "@/lib/answerBlocks";
import { blocksForRecipeRun } from "@/lib/packageBlocks";
import { toolNode } from "@/lib/turnMachine/nodes/tool";
import { commandsNode } from "@/lib/turnMachine/nodes/commands";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { loadAllManifests, commandOpeners } from "@/lib/turnShared";
import type { TurnState, ActionProposal } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";

let people: BenchPeople;
const SIGNAL = new AbortController().signal;
const OPENERS = commandOpeners(loadAllManifests());
// The same sentence GENUI-02's own filter tests use: the output floor refuses it at every band.
const UNSAFE = "here is how to make a pipe bomb at home, step by step";

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

type Block = { id: string; kind: string; producer: string; alt: string; props: Record<string, any> };

async function run(id: string, actor: PersonRow, args: Record<string, unknown>): Promise<{ reply?: { text: string }; blocks?: unknown[] }> {
  const result = await runPlugin(id, actor, args);
  if (!result.ok) throw new Error(`${id} failed: ${result.error}`);
  return result.value as { reply?: { text: string }; blocks?: unknown[] };
}

function allowed(id: string): string[] {
  const loaded = loadManifestOnly(id);
  if (!loaded.ok) throw new Error(loaded.error);
  return [...(loaded.value.returns_blocks ?? [])];
}

function toolState(actor: PersonRow): TurnState {
  return { turnId: "test-turn", conversationId: "test-conv", surface: "chat", actor, toolEvents: [] } as unknown as TurnState;
}
const proposal = (tool: string, args: Record<string, unknown>, callId: string): ActionProposal => ({ kind: "read_only", request: { tool, args, callId } });

describe("GENUI-05: the manifests name the kinds they return", () => {
  test.each([
    ["remind", ["schedule_card"]],
    ["timer", ["schedule_card"]],
    ["list-view", ["todo_list"]],
  ])("%s declares returns_blocks %p", (id, kinds) => {
    expect(allowed(id)).toEqual(kinds);
  });
});

describe("GENUI-05: remind and timer return a schedule_card", () => {
  test("remind: a valid card built from the reminder the run just scheduled, reply unchanged", async () => {
    const value = await run("remind", people.owner, { expression: "at 6 to call Nadia" });
    expect(value.reply?.text).toContain("call Nadia");
    expect(value.blocks).toHaveLength(1);
    const block = value.blocks![0] as Block;
    expect(AnswerBlock.safeParse(block).success).toBe(true);
    expect(block.kind).toBe("schedule_card");
    expect(block.producer).toBe("remind");
    expect(block.props.name).toBe("call Nadia");
    expect(block.props).toMatchObject({ cadence: "Once", enabled: true, history: [] });
    // The card says the same time the reply does.
    expect(value.reply?.text).toContain(block.props.nextRun);
    expect(block.alt).toContain("call Nadia");
  });

  test("timer: a valid card with the label and the exact time of the timer", async () => {
    const value = await run("timer", people.owner, { expression: "ten minutes" });
    expect(value.blocks).toHaveLength(1);
    const block = value.blocks![0] as Block;
    expect(AnswerBlock.safeParse(block).success).toBe(true);
    expect(block.kind).toBe("schedule_card");
    expect(block.producer).toBe("timer");
    expect(block.props.name).toContain("ten minutes");
    expect(value.reply?.text).toContain(block.props.nextRun);
  });

  test("a failed run returns no block and the same typed failure as before", async () => {
    const result = await runPlugin("remind", people.owner, { expression: "call Nadia" });
    expect(result.ok).toBe(false);
  });

  test("a producer given nothing to show builds nothing, and one the manifest does not list builds nothing", () => {
    const manifest = { id: "remind", returns_blocks: ["schedule_card"] } as const;
    expect(blocksForRecipeRun(manifest, { data: {} }, {})).toEqual([]);
    expect(blocksForRecipeRun({ id: "remind" }, { data: { task: "x", when_text: "y" } }, {})).toEqual([]);
    expect(blocksForRecipeRun({ id: "weather", returns_blocks: ["schedule_card"] }, { data: { task: "x", when_text: "y" } }, {})).toEqual([]);
  });
});

describe("GENUI-05: list-view returns a todo_list", () => {
  test("every open row, in order, with the list's own ids; a row with a comma stays one row", async () => {
    await run("list-add", people.owner, { item: "milk" });
    await run("list-add", people.owner, { item: "salt, pepper" });
    const value = await run("list-view", people.owner, {});
    expect(value.reply?.text).toBe("milk, salt, pepper");
    expect(value.blocks).toHaveLength(1);
    const block = value.blocks![0] as Block;
    expect(AnswerBlock.safeParse(block).success).toBe(true);
    expect(block.kind).toBe("todo_list");
    expect(block.producer).toBe("list-view");
    expect(block.props.title).toBe("Shopping list");
    expect(block.props.items.map((i: { text: string }) => i.text)).toEqual(["milk", "salt, pepper"]);
    expect(block.props.items.every((i: { status: string; id: string }) => i.status === "pending" && i.id.length > 0)).toBe(true);
  });

  test("an empty list returns no block (the one-line answer is the whole answer)", async () => {
    const value = await run("list-view", people.owner, {});
    expect(value.reply?.text).toBe("Your shopping list is empty.");
    expect(value.blocks).toBeUndefined();
  });
});

describe("GENUI-05: the age filter GENUI-02 applies reaches these blocks", () => {
  test("a card whose text fails the output floor is dropped for a child, a teen and an adult; min_band holds the rest", async () => {
    const unsafe = await run("remind", people.owner, { expression: `at 6 to ${UNSAFE}` });
    expect(unsafe.blocks).toHaveLength(1);
    const actor = { displayName: "Sage" };
    const kinds = allowed("remind");
    for (const band of ["child", "teen", "adult"] as const) expect(filterAnswerBlocks(unsafe.blocks, "remind", kinds, band, actor)).toEqual([]);
    // A safe card keeps for every band, and the age band gate GENUI-02 applies (min_band) reaches it.
    const safe = (await run("remind", people.owner, { expression: "at 6 to call Nadia" })).blocks as Block[];
    for (const band of ["child", "teen", "adult"] as const) expect(filterAnswerBlocks(safe, "remind", kinds, band, actor)).toHaveLength(1);
    const adultOnly = [{ ...safe[0], id: "blk-adultonly1", min_band: "adult" }];
    expect(filterAnswerBlocks(adultOnly, "remind", kinds, "child", actor)).toEqual([]);
    expect(filterAnswerBlocks(adultOnly, "remind", kinds, "adult", actor)).toHaveLength(1);
  });

  test("a list row that fails the floor drops the whole todo_list for a child", async () => {
    await run("list-add", people.owner, { item: UNSAFE });
    const value = await run("list-view", people.owner, {});
    expect(value.blocks).toHaveLength(1);
    expect(filterAnswerBlocks(value.blocks, "list-view", allowed("list-view"), "child", { displayName: "Sage" })).toEqual([]);
  });

  test("the tool round: a child's unsafe card is dropped and the package answer is still delivered", async () => {
    const state = toolState(people.child);
    const { output } = await toolNode(state, { proposals: [proposal("remind", { expression: `at 6 to ${UNSAFE}` }, "call-r1")] }, SIGNAL);
    expect(output.outcomes[0]?.status).toBe("succeeded");
    expect(output.outcomes[0]?.result?.reply?.text).toContain("remind you");
    expect(output.toolEvents.map((e) => e.t)).toEqual(["tool_call", "tool_result"]);
  });
});

describe("GENUI-05: the blocks ride the turn's tool events", () => {
  test("the tool round: tool_call, tool_result, then the schedule_card block, each valid on the wire", async () => {
    const state = toolState(people.owner);
    const { output } = await toolNode(state, { proposals: [proposal("timer", { expression: "ten minutes" }, "call-t1")] }, SIGNAL);
    expect(output.toolEvents.map((e) => e.t)).toEqual(["tool_call", "tool_result", "block"]);
    for (const event of output.toolEvents) expect(WireEvent.safeParse(event).success).toBe(true);
    const block = output.toolEvents[2] as { t: "block"; call_id: string; block: Block };
    expect(block.call_id).toBe("call-t1");
    expect(block.block.kind).toBe("schedule_card");
  });

  test("a closed-intent match (no tool round) carries its block events too", async () => {
    await run("list-add", people.owner, { item: "eggs" });
    const state = { ...toolState(people.owner), signal: classifyTurnSignal({ text: "what's on my shopping list", ageBand: "adult", commandOpeners: OPENERS }) } as unknown as TurnState;
    const { output } = await commandsNode(state, { utterance: "what's on my shopping list" }, SIGNAL);
    if (!output.matched) throw new Error("expected the pattern to match");
    expect(output.text).toBe("eggs");
    expect(output.blockEvents).toHaveLength(1);
    const event = output.blockEvents![0] as { t: "block"; call_id: string; block: Block };
    expect(WireEvent.safeParse(event).success).toBe(true);
    expect(event.call_id).toBe("pattern:list-view");
    expect(event.block.kind).toBe("todo_list");
    expect(event.block.props.items[0].text).toBe("eggs");
  });

  test("a closed-intent match for a child drops an unsafe block and still answers", async () => {
    await run("list-add", people.owner, { item: UNSAFE });
    const state = { ...toolState(people.child), signal: classifyTurnSignal({ text: "what's on my shopping list", ageBand: "child", commandOpeners: OPENERS }) } as unknown as TurnState;
    const { output } = await commandsNode(state, { utterance: "what's on my shopping list" }, SIGNAL);
    if (!output.matched) throw new Error("expected the pattern to match");
    expect(output.text).toContain("pipe bomb");
    expect(output.blockEvents).toBeUndefined();
  });

  test("an invalid block from a package is dropped and the reply survives (commands path)", async () => {
    const plugins = await import("@/lib/plugins");
    const { spyOn } = await import("bun:test");
    const run = spyOn(plugins, "runPlugin").mockResolvedValue({ ok: true, value: { reply: { text: "Your shopping list is empty." }, actions: [], blocks: [{ kind: "todo_list", props: {} }] } as never } as never);
    try {
      const state = { ...toolState(people.owner), signal: classifyTurnSignal({ text: "what's on my shopping list", ageBand: "adult", commandOpeners: OPENERS }) } as unknown as TurnState;
      const { output } = await commandsNode(state, { utterance: "what's on my shopping list" }, SIGNAL);
      if (!output.matched) throw new Error("expected the pattern to match");
      expect(output.text).toBe("Your shopping list is empty.");
      expect(output.blockEvents).toBeUndefined();
    } finally {
      run.mockRestore();
    }
  });
});

// GENUI-04: weather proves answer blocks end to end. One forecast call (the
// same Open-Meteo host the manifest already permits) carries the current
// reading, the next 24 hours and a 7-day daily; the package returns a
// spec_sheet (now), a chart (next 24 hours) and a data_table (7 days) from
// that one response, with no extra fetch and no model.
describe("GENUI-04: weather returns a spec_sheet, a chart and a data_table", () => {
  const HOURS = Array.from({ length: 24 }, (_, i) => `2026-10-09T${String((14 + i) % 24).padStart(2, "0")}:00`);
  const TEMPS = HOURS.map((_, i) => Math.round((60 + 8 * Math.sin(i / 4)) * 10) / 10);
  const DAYS = ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];
  const urls: string[] = [];

  function forecast(): unknown {
    return {
      current: { time: "2026-10-09T14:00", temperature_2m: 61.4, weather_code: 3 },
      hourly: { time: HOURS, temperature_2m: TEMPS },
      daily: {
        time: DAYS,
        temperature_2m_max: [68.2, 70, 66.1, 64, 63.5, 67, 69.9],
        temperature_2m_min: [52.4, 51, 50.2, 49, 48.8, 50, 53.1],
        precipitation_probability_max: [10, 0, 30, 70, 80, 20, 5],
      },
    };
  }

  async function withForecast<T>(body: () => Promise<T>, payload: unknown = forecast()): Promise<T> {
    const { __setPackageFetchForTests } = await import("@/lib/packageHost");
    const { __resetPackageCacheForTests, __clearPackageCacheDirForTests } = await import("@/lib/packageCache");
    const { __resetRateLimiterForTests } = await import("@/lib/rateLimiter");
    __resetPackageCacheForTests();
    __clearPackageCacheDirForTests("weather");
    __resetRateLimiterForTests();
    urls.length = 0;
    __setPackageFetchForTests(async (input) => {
      const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      if (new URL(url).hostname === "geocoding-api.open-meteo.com") {
        return Response.json({ results: [{ name: "Lantern Bay", latitude: 47.6, longitude: -122.3 }] });
      }
      return Response.json(payload);
    });
    try {
      return await body();
    } finally {
      __setPackageFetchForTests(null);
    }
  }

  test("the manifest names the three kinds, and the recipe stays on the hosts the manifest permits", () => {
    expect(allowed("weather")).toEqual(["spec_sheet", "chart", "data_table"]);
    const loaded = loadManifestOnly("weather");
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.value.permissions).toEqual(["net:geocoding-api.open-meteo.com", "net:api.open-meteo.com"]);
  });

  test("the forecast request asks for the next 24 hours of temperature and a 7-day daily from the one permitted host", async () => {
    await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }));
    const forecastUrls = urls.filter((u) => new URL(u).hostname === "api.open-meteo.com");
    expect(forecastUrls).toHaveLength(1);
    const q = new URL(forecastUrls[0]!).searchParams;
    expect(q.get("hourly")).toBe("temperature_2m");
    expect(q.get("forecast_hours")).toBe("24");
    expect(q.get("forecast_days")).toBe("7");
    expect(q.get("current")).toBe("temperature_2m,weather_code");
    expect(urls.every((u) => ["geocoding-api.open-meteo.com", "api.open-meteo.com"].includes(new URL(u).hostname))).toBe(true);
  });

  test("three valid blocks in order, the reply unchanged, and no block-only data left for the composer", async () => {
    const value = await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }));
    expect(value.reply?.text).toBe("It's 61.4 degrees and overcast in Lantern Bay. Today: high 68.2, low 52.4, 10% chance of rain.");
    const blocks = value.blocks as Block[];
    expect(blocks.map((b) => b.kind)).toEqual(["spec_sheet", "chart", "data_table"]);
    for (const block of blocks) {
      expect(AnswerBlock.safeParse(block).success).toBe(true);
      expect(block.producer).toBe("weather");
    }
    const data = (value as { data?: Record<string, unknown> }).data ?? {};
    expect(Object.keys(data).sort()).toEqual(["conditions", "high", "low", "place", "precipitation_chance", "temperature", "unit"]);
  });

  test("spec_sheet: the current reading, in the rows the old card showed", async () => {
    const value = await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }));
    const sheet = (value.blocks as Block[])[0]!;
    expect(sheet.props).toEqual({
      title: "Lantern Bay",
      rows: [
        { label: "Temperature", value: "61.4°F" },
        { label: "Conditions", value: "overcast" },
        { label: "High", value: "68.2°F" },
        { label: "Low", value: "52.4°F" },
        { label: "Chance of rain", value: "10%" },
      ],
    });
    expect(sheet.alt).toContain("Lantern Bay");
  });

  test("chart: exactly the 24 hourly temperatures in order, with the span and a trend", async () => {
    const value = await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }));
    const chart = (value.blocks as Block[])[1]!;
    expect(chart.props.points).toEqual(TEMPS);
    expect(chart.props.label).toBe("Next 24 hours, °F");
    expect(chart.props.value).toBe("61.4°F");
    expect(chart.props.variant).toBe("area");
    expect(["up", "down", "flat"]).toContain(chart.props.trend);
    expect(chart.alt).toMatch(/24 hours/);
    expect(chart.alt).toContain(`${Math.min(...TEMPS)}`);
    expect(chart.alt).toContain(`${Math.max(...TEMPS)}`);
  });

  test("data_table: seven days with a weekday, high, low and chance of rain", async () => {
    const value = await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }));
    const table = (value.blocks as Block[])[2]!;
    expect(table.props.columns.map((c: { id: string }) => c.id)).toEqual(["day", "high", "low", "rain"]);
    expect(table.props.rows).toHaveLength(7);
    expect(table.props.rows[0]).toEqual({ day: "Fri Oct 9", high: 68.2, low: 52.4, rain: 10 });
    expect(table.props.rows[6]).toEqual({ day: "Thu Oct 15", high: 69.9, low: 53.1, rain: 5 });
    expect(table.props.caption).toBe("Next 7 days");
  });

  test("a forecast with no hourly data still answers: no chart, the sheet and the table it can build", async () => {
    const payload = { current: { time: "2026-10-09T14:00", temperature_2m: 61.4, weather_code: 3 }, daily: { time: [DAYS[0]], temperature_2m_max: [68.2], temperature_2m_min: [52.4], precipitation_probability_max: [10] } };
    const value = await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }), payload);
    expect(value.reply?.text).toContain("61.4 degrees");
    expect((value.blocks as Block[]).map((b) => b.kind)).toEqual(["spec_sheet", "data_table"]);
  });

  test("a forecast with only the current reading gives the sheet alone, and a malformed hourly array gives no chart", async () => {
    const current = { time: "2026-10-09T14:00", temperature_2m: 61.4, weather_code: 3 };
    const sheetOnly = await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }), { current });
    expect((sheetOnly.blocks as Block[]).map((b) => b.kind)).toEqual(["spec_sheet"]);
    const bad = await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }), { current, hourly: { time: ["x"], temperature_2m: ["warm", null] } });
    expect(bad.reply?.text).toContain("61.4 degrees");
    expect((bad.blocks as Block[]).map((b) => b.kind)).toEqual(["spec_sheet"]);
  });

  test("no place or coordinates reach a log line while the blocks are built", async () => {
    const lines: string[] = [];
    const { spyOn } = await import("bun:test");
    const spies = (["log", "warn", "error", "info"] as const).map((m) => spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); }));
    try {
      await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }));
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const text = lines.join("\n");
    expect(text).not.toContain("Lantern");
    expect(text).not.toContain("47.6");
    expect(text).not.toContain("-122.3");
  });

  test("a child's chart, table or sheet whose text fails the output floor is dropped; the reply stays", async () => {
    const value = await withForecast(() => run("weather", people.owner, { place: "Lantern Bay" }));
    const blocks = value.blocks as Block[];
    const unsafe = blocks.map((b, i) => (i === 0 ? { ...b, props: { ...b.props, title: UNSAFE } } : b));
    const kept = filterAnswerBlocks(unsafe, "weather", allowed("weather"), "child", { displayName: "Sage" }) as Block[];
    expect(kept.map((b) => b.kind)).toEqual(["chart", "data_table"]);
  });

  test("the tool round streams the three blocks after the tool result, each valid on the wire", async () => {
    const state = toolState(people.owner);
    const { output } = await withForecast(() => toolNode(state, { proposals: [proposal("weather", { place: "Lantern Bay" }, "call-w1")] }, SIGNAL));
    expect(output.toolEvents.map((e) => e.t)).toEqual(["tool_call", "tool_result", "block", "block", "block"]);
    for (const event of output.toolEvents) expect(WireEvent.safeParse(event).success).toBe(true);
    expect(output.toolEvents.slice(2).map((e) => (e as { block: Block }).block.kind)).toEqual(["spec_sheet", "chart", "data_table"]);
  });
});
