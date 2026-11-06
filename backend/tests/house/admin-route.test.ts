import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { app } from "@/app";
import { __setHouseRoomsDepsForTests } from "@/routes/house";
import { owner, child, teen } from "../support/testAuth";
import { resetDb } from "../reset-db";

beforeEach(() => resetDb());
afterEach(() => __setHouseRoomsDepsForTests());

describe("House admin routes", () => {
  test("registry is owner/admin only and returns the full registry", async () => {
    const { client } = await owner();
    __setHouseRoomsDepsForTests({ loadRegistry: async () => ({ ok: true, areas: [{ id: "k", name: "Kitchen" }], entities: [{ id: "light.kitchen", name: "Kitchen light", kind: "light", area: "k", state: "on", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null }] }) });
    expect((await client.get("/api/house/admin/registry")).status).toBe(200);
    const teenClient = await teen(client);
    expect((await teenClient.get("/api/house/admin/registry")).status).toBe(403);
    const { client: childClient } = await child(client);
    expect((await childClient.get("/api/house/admin/registry")).status).toBe(403);
    expect((await app.request("/api/house/admin/registry")).status).toBe(401);
  });

  test("test route gives numeric-address, refused-token and unreachable next steps", async () => {
    const { client } = await owner();
    __setHouseRoomsDepsForTests({ connection: () => ({ ok: false, reason: "bad_address", message: "internal" }) as never });
    expect(await (await client.post("/api/house/test")).json()).toMatchObject({ ok: false, nextStep: "Use a numeric address like http://192.0.2.10:8123." });
    __setHouseRoomsDepsForTests({ connection: () => ({ ok: true, token: "x", lanFetch: async () => ({ ok: false, kind: "refused" }) }) as never });
    expect(await (await client.post("/api/house/test")).json()).toMatchObject({ ok: false, nextStep: "Home Assistant refused the token. Create a new long-lived token in your Home Assistant profile." });
    __setHouseRoomsDepsForTests({ connection: () => ({ ok: true, token: "x", lanFetch: async () => ({ ok: false, kind: "unreachable" }) }) as never });
    expect(await (await client.post("/api/house/test")).json()).toMatchObject({ ok: false, nextStep: "Check that Home Assistant is on and reachable at that address." });
  });
});
