import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { StackError } from "@/lib/stack/errors";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";
import { makePlan } from "./fixtures/fitPlanFixtures";

describe("POST /api/fit-plan", () => {
  beforeEach(() => resetDb());
  afterEach(() => __resetStackEngineForTests());

  async function postFit(value: StackFitPlan | Error, body: unknown = { source: { repo: "Qwen/Qwen3-8B", revision: "main" } }, status?: number) {
    const clientStub = { fitPlan: async () => { if (value instanceof Error) throw value; return value; } } as unknown as StackClient;
    __setStackClientForTests(clientStub);
    const { client } = await owner();
    return client.post("/api/fit-plan", body);
  }

  test("returns the Stack plan with yes wording", async () => {
    const response = await postFit(makePlan("yes"));
    expect(response.status).toBe(2 * 100);
    const body = await response.json() as { plan: StackFitPlan; wording: { verdict: string; headline: string; detail: string } };
    expect(body.plan.verdict).toBe("yes");
    expect(body.wording.headline).toBe("Runs well on this computer");
  });

  test("returns the no plan with its wording", async () => {
    const noResponse = await postFit(makePlan("no"));
    expect((await noResponse.json() as { wording: { verdict: string } }).wording.verdict).toBe("no");
  });

  test("returns the unknown plan with its wording", async () => {
    const unknownResponse = await postFit(makePlan("unknown"));
    expect((await unknownResponse.json() as { wording: { verdict: string } }).wording.verdict).toBe("unknown");
  });

  test("returns unavailable wording when the Stack throws", async () => {
    const response = await postFit(new StackError("unreachable", "unavailable"));
    expect(response.status).toBe(2 * 100);
    expect(await response.json()).toEqual({ plan: null, wording: { verdict: "unknown", headline: "Can't check right now", detail: "The model size checker did not answer. Try again in a moment." } });
  });

  test("maps a Stack bad source to Home 400", async () => {
    const response = await postFit(new StackError("unknown", "bad source", { status: 4 * 100 }));
    expect(response.status).toBe(4 * 100);
    expect(await response.json()).toEqual({ error: "bad source" });
  });

  test("rejects unknown body keys", async () => {
    const response = await postFit(makePlan("yes"), { source: { repo: "Qwen/Qwen3-8B" }, extra: true });
    expect(response.status).toBe(4 * 100);
  });

  test("rejects unauthenticated requests", async () => {
    __setStackClientForTests({ fitPlan: async () => makePlan("yes") } as unknown as StackClient);
    const response = await (await import("@/app")).app.request("/api/fit-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: { repo: "Qwen/Qwen3-8B" } }) });
    expect(response.status).toBe(4 * 100 + 1);
  });
});
