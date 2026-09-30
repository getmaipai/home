import { expect, test } from "bun:test";
import { createStackClient } from "@/lib/stack/client";
import { makePlan } from "./fixtures/fitPlanFixtures";

test("fitPlan sends the POST path and JSON body", async () => {
  const fixture = makePlan("yes");
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const client = createStackClient({
    fetch: (async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json(fixture);
    }) as typeof fetch,
  });
  const body = { source: { repo: "alfred/example", revision: "main" }, context_tokens: 2 ** 11, kv_cache_type: "q8_0" as const };
  expect((await client.fitPlan(body)).verdict).toBe("yes");
  expect(capturedUrl.endsWith("/stack/v1/fit-plan")).toBe(true);
  expect(capturedInit?.method).toBe("POST");
  expect(JSON.parse(String(capturedInit?.body))).toEqual(body);
});
