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
} from "@/lib/remoteStackSettings";

beforeEach(() => {
  resetDb();
  __resetStackLinkControlForTests();
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
    });
    await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.host", value: "192.168.1.20" });
    await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "another_computer" });
    expect(calls).toEqual(["stop"]);
    await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "this_computer" });
    expect(calls).toEqual(["stop", "start-and-clear-link"]);
    expect(getHouseholdSettingValue("engines.stack.remote.host")).toBe("");
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
