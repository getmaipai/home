// ROBOT-COMPANION-01, DYNAMIC-COMPANION-01 and WEATHER-KID-01: real robot turns through the machine. The robot's controls set the plan's band and
// the companion the reply's voice; an unassigned robot keeps the child result; a child can ask the weather and gets a forecast from the household home.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { __clearPackageCacheDirForTests } from "@/lib/packageCache";
import { __resetPackageQuietWindowsForTests } from "@/lib/packageHost";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { createDevice } from "@/lib/devices";
import { createEntity } from "@/lib/entities";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { withStub } from "./toolHarness";
import type { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";

const FORECAST = { current: { temperature_2m: 61, weather_code: 61 }, hourly: { time: ["2026-10-21T05:00"], temperature_2m: [60], precipitation_probability: [80] }, daily: { time: ["2026-10-21"], temperature_2m_max: [64], temperature_2m_min: [50], precipitation_probability_max: [80], weather_code: [61] } };
const realFetch = globalThis.fetch;
let outbound: string[] = [];
let people: BenchPeople;
let deviceId: string;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetPackageQuietWindowsForTests();
  __clearPackageCacheDirForTests("weather");
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  deviceId = createDevice("robot", "StackChan", people.owner.id).id;
  outbound = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("open-meteo.com")) return realFetch(input as never, init);
    outbound.push(url);
    return Response.json(FORECAST);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function assign(controls: "child" | "teen" | "adult", companion: string): Promise<void> {
  expect((await setValue(people.owner, `device:${deviceId}`, "robot.controls", controls)).ok).toBe(true);
  if (companion) expect((await setValue(people.owner, `device:${deviceId}`, "robot.companion.id", companion)).ok).toBe(true);
}

type Seen = Parameters<Parameters<typeof withStub>[1]>[0];
async function robotTurn(text: string, call?: { name: string; args: unknown }): Promise<{ plan: ReplyPlan; reply: string; seen: Seen }> {
  return withStub(
    {
      calls: (request) => (!call || request.tool_choice === "none" || request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-1", name: call.name, args: JSON.stringify(call.args) }]),
      reply: (request) => (request.messages.some((m) => m.role === "tool") ? "It looks like rain today, so bring your boots!" : "Oh nice, what kind?"),
    },
    async (seen) => {
      const result = await runTurnNext(people.owner, "robot", text, { deviceId, speakerEvidence: null, present: null, spoken: true });
      if (!result.ok || result.kind !== "immediate") throw new Error(`turn failed: ${JSON.stringify(result)}`);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get()!;
      return { plan: JSON.parse(row.plan as string) as ReplyPlan, reply: row.replyText, seen };
    },
  );
}

const MOVES = (plan: ReplyPlan) => Object.fromEntries(Object.entries(plan.moves).filter(([, v]) => v !== "forbidden"));

describe("the companion governs the plan of a robot turn", () => {
  test("no companion: the child result, as before", async () => {
    const { plan } = await robotTurn("I'm making slushies today");
    expect(plan.age_band).toBe("child");
    expect(plan.moves.ask_back).toBe("forbidden");
    console.log("unassigned plan", JSON.stringify({ age_band: plan.age_band, moves: MOVES(plan), max_words: plan.max_words, vocabulary: plan.vocabulary_level }));
  });

  for (const [controls, companion, band] of [["child", "lively-child", "child"], ["teen", "lively-teen", "teen"], ["adult", "lively-adult", "adult"], ["adult", "rivet", "adult"]] as const) {
    const speaker = { "lively-child": "Sprout", "lively-teen": "Riff", "lively-adult": "Nova", rivet: "Rivet" }[companion];
    test(`${companion} on a ${controls}-controls robot plans a ${band} turn, lively, and speaks as that companion`, async () => {
      await assign(controls, companion);
      const { plan, seen } = await robotTurn("I'm making slushies today");
      expect(plan.age_band).toBe(band);
      expect(plan.moves.react).not.toBe("forbidden");
      expect(plan.moves.ask_back).not.toBe("forbidden");
      expect(plan.vocabulary_level).toBe(band === "child" ? "simple" : "standard");
      const system = JSON.stringify(seen[0]!.messages.filter((m) => m.role === "system"));
      expect(system).toContain(`You are ${speaker}`);
      console.log(`${companion} plan`, JSON.stringify({ age_band: plan.age_band, moves: MOVES(plan), max_words: plan.max_words, vocabulary: plan.vocabulary_level }));
    });
  }

  test("the same dynamic companion on a child robot plans a child turn with the child lines, and on an adult robot an adult turn with the adult lines", async () => {
    await assign("child", "lively-adult");
    const child = await robotTurn("I'm making slushies today");
    expect(child.plan.age_band).toBe("child");
    expect(child.plan.moves.ask_back).not.toBe("forbidden");
    const childSystem = JSON.stringify(child.seen[0]!.messages.filter((m) => m.role === "system"));
    expect(childSystem).toContain("Yum! Which flavor is your favorite?");
    expect(childSystem).not.toContain("That sounds like a great plan. When are you starting?");
    await assign("adult", "lively-adult");
    const adult = await robotTurn("I'm making slushies today");
    expect(adult.plan.age_band).toBe("adult");
    expect(adult.plan.moves.react).not.toBe("forbidden");
    expect(adult.plan.moves.ask_back).not.toBe("forbidden");
    expect(JSON.stringify(adult.seen[0]!.messages.filter((m) => m.role === "system"))).toContain("Ooh, slushies, nice. What flavor are you making?");
  });

  test("a child-named dynamic companion on an adult's robot takes the robot's controls (adult), not its own name; a child robot never loosens", async () => {
    await assign("adult", "lively-child");
    expect((await robotTurn("hi there")).plan.age_band).toBe("adult");
    await assign("child", "lively-adult");
    expect((await robotTurn("hi there")).plan.age_band).toBe("child");
  });

  test("lowering the controls falls back safely: a robot at child with no companion is the strictest turn", async () => {
    await assign("adult", "lively-adult");
    expect((await robotTurn("hi there")).plan.age_band).toBe("adult");
    expect((await setValue(people.owner, `device:${deviceId}`, "robot.companion.id", "")).ok).toBe(true);
    expect((await robotTurn("hi there")).plan.age_band).toBe("child");
  });
});

describe("kids can ask the weather", () => {
  function household(): void {
    const home = createEntity(people.owner, { kind: "place", place_kind: "map", name: "Home", scope: "household", geo: { lat: 47.6062, lon: -122.3321, precision: "exact", area: "Seattle, Washington", from: "typed" } } as never);
    if (!home.ok) throw new Error(JSON.stringify(home));
    expect(setHouseholdSettingValue("household.home", home.value!.id).ok).toBe(true);
  }

  test("a child companion robot with a household home gets a forecast, from the home, coarsely", async () => {
    household();
    await assign("child", "lively-child");
    const { reply, plan } = await robotTurn("Is it going to rain?", { name: "weather", args: {} });
    expect(plan.age_band).toBe("child");
    const forecast = outbound.find((url) => url.includes("/v1/forecast"));
    expect(forecast).toBeDefined();
    expect(forecast).toContain("latitude=47.6&longitude=-122.3");
    expect(reply).not.toContain("without knowing where");
  });

  test("a teen and an adult companion robot get the same forecast at the finer rounding", async () => {
    household();
    await assign("adult", "lively-teen");
    await robotTurn("Is it going to rain?", { name: "weather", args: {} });
    expect(outbound.find((url) => url.includes("/v1/forecast"))).toContain("latitude=47.61&longitude=-122.33");
  });

  test("with no household home the tool says where to set it and no forecast is fetched", async () => {
    await assign("child", "lively-child");
    const { seen } = await robotTurn("Is it going to rain?", { name: "weather", args: {} });
    expect(outbound.some((url) => url.includes("/v1/forecast"))).toBe(false);
    expect(JSON.stringify(seen)).toContain("Home location in Settings");
  });
});
