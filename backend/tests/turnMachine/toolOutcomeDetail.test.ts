// R2 (tools design, rule 6): a tool outcome carries a failure kind and an admin-only `detail`.
// The raw error text is in no model request, no wire event, no reply and no composer message
// (a test per consumer of the outcome), and stays on the stored outcome record for THIN-1E.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { outcomeOf, outcomeText } from "@/lib/turnContext";
import { toolResultContent } from "@/lib/composer";
import { withStub, failWeather, script, replies, MARKER, WEATHER_CALL } from "./toolHarness";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

describe("R2: the raw error never reaches the model or the wire, and stays on the record", () => {
  test("the tool outcome carries a failure kind and an admin-only detail; the wire event and every model request carry neither the raw text nor the field", async () => {
    const { spy } = failWeather();
    try {
      await withStub(
        {
          calls: script(),
          reply: replies,
        },
        async (seen) => {
          const result = await runTurnNext(people.owner, "chat", "what is the weather in oslo today");
          expect(result.ok).toBe(true);
          if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
          // Wire: the tool_error event is a kind, never the raw error; the whole result carries no marker.
          const errorEvent = result.toolEvents!.find((e) => e.t === "tool_error");
          expect(errorEvent).toMatchObject({ t: "tool_error", package_id: "weather", error: "errored" });
          expect(JSON.stringify(result.toolEvents)).not.toContain(MARKER);
          expect(JSON.stringify(result.value)).not.toContain(MARKER);
          expect(result.value.reply.text).not.toContain(MARKER);
          // Model: no request carries the marker or the field name.
          for (const request of seen) {
            expect(JSON.stringify(request)).not.toContain(MARKER);
            expect(JSON.stringify(request)).not.toContain("detail");
          }
          // Record: kind and raw detail stored for THIN-1E, and no userMessage on a tool failure.
          const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
          const stored = (JSON.parse(row!.outcomes as unknown as string) as Record<string, unknown>[]).find((o) => o.packageId === "weather")!;
          expect(stored.status).toBe("failed");
          expect(stored.failureKind).toBe("errored");
          expect(String(stored.detail)).toContain(MARKER);
          expect(stored.userMessage).toBeUndefined();
        },
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("a streamed turn's NDJSON-bound events carry no raw error either", async () => {
    const { runTurnNextStream } = await import("@/lib/turnMachine/turnNext");
    const { spy } = failWeather();
    try {
      await withStub(
        {
          calls: script(),
          reply: replies,
        },
        async () => {
          const result = await runTurnNextStream(people.owner, "chat", "what is the weather in oslo today");
          if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
          let text = "";
          for (;;) {
            const step = await result.tokens.next();
            if (step.done) {
              const value = result.finalize(text.trim(), step.value);
              expect(JSON.stringify(value)).not.toContain(MARKER);
              break;
            }
            text += step.value;
          }
          expect(text).not.toContain(MARKER);
          expect(JSON.stringify(result.toolEvents ?? [])).not.toContain(MARKER);
        },
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("the reply built straight from a failed outcome (no model round follows) never carries the raw error", () => {
    const failed = outcomeOf({ callId: "c", packageId: "weather", status: "failed", via: "tool_call", failureKind: "errored", detail: `boom ${MARKER}` });
    expect(outcomeText(failed)).not.toContain(MARKER);
  });

  test("the composer's tool message for a failed outcome carries the kind, never the detail", () => {
    const failed = outcomeOf({ callId: "c", packageId: "weather", status: "failed", via: "tool_call", errorCode: "upstream_broke", failureKind: "errored", detail: `boom ${MARKER}` });
    const content = toolResultContent(failed);
    expect(content).not.toContain(MARKER);
    expect(content).toContain("errored");
  });
});
