import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { privacyConnections } from "@/lib/privacy";
import {
  __resetStackLinkControlForTests,
  REMOTE_ENGINE_ADDRESS_ERROR,
  REMOTE_ENGINE_TAILNET_DISABLE_ERROR,
  REMOTE_ENGINE_TAILNET_ERROR,
  setStackLinkControl,
  startConfiguredEngineLinkIfSelected,
} from "@/lib/remoteStackSettings";
import { getEngineLink, __setEngineLinkForTests, type EngineLink } from "@/lib/stack/link";
import { __resetStackEngineForTests, __setStackClientForTests, getStackClient } from "@/lib/stackEngine";

beforeEach(() => {
  resetDb();
  __resetStackLinkControlForTests();
  __setEngineLinkForTests(null);
  __resetStackEngineForTests();
});

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Marlow", secret: "1234" });
  return client;
}

describe("remote Stack settings", () => {
  test("refuses a public address with the exact default and tailnet-on messages", async () => {
    const client = await owner();
    const off = await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.host", value: "8.8.8.8" });
    expect(off.status).toBe(400);
    expect(await off.json()).toEqual({ error: REMOTE_ENGINE_ADDRESS_ERROR });
    await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.allow_tailnet", value: true });
    const on = await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.host", value: "8.8.8.8" });
    expect(on.status).toBe(400);
    expect(await on.json()).toEqual({ error: REMOTE_ENGINE_TAILNET_ERROR });
  });

  test("refuses a tailnet address by default, accepts it when enabled, and refuses disabling on it", async () => {
    const client = await owner();
    const refused = await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.host", value: "100.64.0.8" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: REMOTE_ENGINE_ADDRESS_ERROR });
    await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.allow_tailnet", value: true });
    expect((await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.host", value: "100.64.0.8" })).status).toBe(200);
    const disable = await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.allow_tailnet", value: false });
    expect(disable.status).toBe(400);
    expect(await disable.json()).toEqual({ error: REMOTE_ENGINE_TAILNET_DISABLE_ERROR });
  });

  test("another computer stops local Stack; this computer starts it and clears the link", async () => {
    const client = await owner();
    const calls: string[] = [];
    setStackLinkControl({
      async stopLocalStack() { calls.push("stop"); },
      async startLocalStackAndClearLink() { calls.push("start-and-clear-link"); },
      startLink() { calls.push("start-link"); },
      stopLink() { calls.push("stop-link"); },
      refreshLink() { calls.push("refresh-link"); },
    });
    await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.host", value: "192.168.1.20" });
    await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "another_computer" });
    expect(calls).toEqual(["stop", "start-link"]);
    await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "this_computer" });
    expect(calls).toEqual(["stop", "start-link", "stop-link", "start-and-clear-link"]);
    expect(getHouseholdSettingValue("engines.stack.remote.host")).toBe("");
  });

  // ENGINES-AI-01: why "Where the engine runs" could not be switched. The real service control (no mock) tried to stop
  // the local Stack, a Home without the service installed threw from that step, and the PUT answered 500 after the
  // value was saved, so the control snapped back. These are the exact inputs: no control mock, no Stack binary.
  test("switching where saves and answers 200 even when the local Stack service cannot be stopped or started", async () => {
    const client = await owner();
    const ok = await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "another_computer" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { value: string }).value).toBe("another_computer");
    expect(getHouseholdSettingValue("engines.stack.where")).toBe("another_computer");
    const back = await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "this_computer" });
    expect(back.status).toBe(200);
    expect(getHouseholdSettingValue("engines.stack.where")).toBe("this_computer");
    expect(getHouseholdSettingValue("engines.stack.remote.host")).toBe("");
  });

  test("a service command that exits with an error does not turn the save into a failure either", async () => {
    const { __setStackServiceRunnerForTests } = await import("@/lib/localStackService");
    __setStackServiceRunnerForTests(() => { throw new Error("service manager refused"); });
    try {
      const client = await owner();
      expect((await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "another_computer" })).status).toBe(200);
      expect((await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "this_computer" })).status).toBe(200);
      expect(getHouseholdSettingValue("engines.stack.where")).toBe("this_computer");
    } finally {
      __setStackServiceRunnerForTests(null);
    }
  });

  test("this computer selection does not start the link at boot", () => {
    startConfiguredEngineLinkIfSelected();
    expect(getEngineLink()).toBeNull();
  });

  test("remote selection without a ready link fails before a Stack client or network call", () => {
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    setHouseholdSettingValue("engines.stack.remote.host", "192.168.1.20");
    __setStackClientForTests(null);
    expect(() => getStackClient()).toThrow(expect.objectContaining({ kind: "unreachable" }));
  });

  test("privacy rows appear only for a remote engine and the away row only when enabled", () => {
    const ids = () => privacyConnections().map((row) => row.id);
    expect(ids()).not.toContain("platform:engine-computer");
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    expect(ids()).toContain("platform:engine-computer");
    expect(ids()).not.toContain("platform:engine-computer-away");
    setHouseholdSettingValue("engines.stack.remote.allow_tailnet", true);
    expect(ids()).toContain("platform:engine-computer-away");
  });
});
