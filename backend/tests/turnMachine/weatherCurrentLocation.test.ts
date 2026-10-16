// PLACE-WEATHER-01: a turn with no named place uses this request's Current location. The
// coordinates reach one outbound Open-Meteo call (rounded) and nowhere else: not the model
// request, the stored turn row, the wire events, a log line or the package cache.
import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { __clearPackageCacheDirForTests } from "@/lib/packageCache";
import { __resetPackageQuietWindowsForTests } from "@/lib/packageHost";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withStub, replies } from "./toolHarness";

const FORECAST = { current: { temperature_2m: 51.2, weather_code: 3 }, hourly: { time: ["2026-09-05T05:00"], temperature_2m: [51] }, daily: { time: ["2026-09-05"], temperature_2m_max: [58.1], temperature_2m_min: [44.9], precipitation_probability_max: [20] } };
const REAL = { lat: 47.60621, lon: -122.33207 };
const FRAGMENTS = ["47.606", "122.332", "47.61", "122.33"];

let people: BenchPeople;
const realFetch = globalThis.fetch;
let outbound: string[] = [];

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

describe("weather turn with Current location", () => {
  test("an omitted place uses the request coordinates, rounded outbound, and nothing else carries them", async () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level).mockImplementation((...parts: unknown[]) => { logged.push(parts.map(String).join(" ")); }));
    try {
      await withStub(
        {
          calls: (request) => (request.tool_choice === "none" || request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-w", name: "weather", args: "{}" }]),
          reply: replies,
        },
        async (seen) => {
          const result = await runTurnNext(people.owner, "chat", "what's the weather", { currentLocation: REAL });
          expect(result.ok).toBe(true);
          if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
          const forecast = outbound.find((url) => url.includes("/v1/forecast"));
          expect(forecast).toContain("latitude=47.61&longitude=-122.33");
          expect(outbound.some((url) => url.includes("geocoding-api"))).toBe(false);
          const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
          const everywhere = JSON.stringify({ row, wire: result.toolEvents, value: result.value, seen, logged });
          for (const fragment of FRAGMENTS) expect(everywhere).not.toContain(fragment);
        },
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
