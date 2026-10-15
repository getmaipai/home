import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SetupState } from "@maipai/spec/gen/ts/setup-state.js";
import { scenarioList } from "./scenarios";
import { installFetchHandlers } from "./handlers";

const commons = resolve(fileURLToPath(new URL("../../../../node_modules/@maipai/spec", import.meta.url)));
const stackJobSchema = JSON.parse(readFileSync(resolve(commons, "schemas/stack-job.schema.json"), "utf8")) as object;
const healthSchema = JSON.parse(readFileSync(resolve(commons, "schemas/health-item.schema.json"), "utf8")) as object;
const openapi = JSON.parse(readFileSync(resolve("../docs/api/openapi.json"), "utf8")) as Record<string, unknown>;

describe("setup preview scenario validation", () => {
  test("all setup records validate with the pinned spec schema", () => {
    for (const scenario of scenarioList) if (!("done" in scenario.state)) expect(SetupState.safeParse(scenario.state).success).toBe(true);
    expect(stackJobSchema).toBeTruthy();
    expect(healthSchema).toBeTruthy();
    expect(openapi).toBeTruthy();
  });
  test("a deliberately malformed setup scenario is rejected", () => {
    const wrong = { ...scenarioList[0]!.state, phase: "not-a-real-phase" };
    expect(SetupState.safeParse(wrong).success).toBe(false);
  });
  test("scenario fixtures use synthetic addresses only", () => {
    const text = JSON.stringify(scenarioList);
    expect(text).not.toMatch(/(?:100\.|192\.168\.|10\.)\d{1,3}\.\d{1,3}/);
    expect(text).not.toMatch(/@[\w-]+\.tail[a-z]+/i);
  });
  test("every wizard API call is mocked and no request can leave the page", async () => {
    const fake = { fetch: globalThis.fetch };
    const mock = installFetchHandlers(scenarioList[0]!, fake as typeof globalThis);
    try {
      for (const [method, path] of [["GET", "/api/setup/state"], ["POST", "/api/setup/checks/run"], ["GET", "/api/setup/ca"], ["GET", "/api/tailscale/status"], ["GET", "/api/backups/emergency-kit"], ["POST", "/api/auth/setup"], ["POST", "/api/setup/owner"]] as const) {
        const response = await fake.fetch(`http://localhost${path}`, { method });
        expect(response.ok).toBe(true);
      }
      expect(mock.requests).toHaveLength(7);
      await expect(fake.fetch("https://example.com/escape")).rejects.toThrow("blocked outbound");
      expect(mock.requests).toHaveLength(7);
    } finally { mock.restore(); }
  });
});
