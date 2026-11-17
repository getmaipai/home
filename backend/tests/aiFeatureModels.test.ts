// The Features tab read: names, lines and sizes are the Stack's, the household's order only reorders them, a child or teen gets the minor
// list, and the order is written once by Home and sent to the Stack (rules E1, E5, E6).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { featureModels } from "@/lib/featureModels";
import type { StackClient } from "@/lib/stack/client";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const view = (id: string, category: string, priority: number, over: Record<string, unknown> = {}) => ({
  id, kind: "model", category, priority, label: `Label ${id}`, description: `Does ${id}.`, enabled: true, state: "ready", size_bytes: 20e9, download_bytes: 0, percent: null,
  fits: { standard: true, boost: true, max: true, reason: null }, can_install: true, install_block: null, can_uninstall: true, uninstall_block: null, licence_needed: false, required_by: [], update: { available: false, version: null }, ...over,
});
const catalogJob = (job: string, part: string | null, alternatives: string[]) => ({ job, available: part !== null, part: part ? { id: part, label: `Label ${part}` } : null, alternatives: alternatives.map((id) => ({ part: id, label: `Label ${id}` })) });

let audiences: string[] = [];
let pushed: unknown[] = [];
let failPush = false;
const stack = () => ({
  parts: async (query: { audience: string }) => {
    audiences.push(query.audience);
    return { audience: query.audience, parts: [view("p1", "pictures", 1), view("p2", "pictures", 2, { state: "missing", size_bytes: 0, download_bytes: 36e9 }), view("p3", "pictures", 3, { state: "missing", size_bytes: 0, download_bytes: 9e9 }), view("p4", "pictures", 4), view("v1", "video", 1), view("m1", "music", 1), view("c1", "chat", 1)] };
  },
  jobsCatalog: async () => ({ audience: "adult", jobs: [catalogJob("picture", "p1", ["p2"]), catalogJob("picture_edit", "p1", ["p2"]), catalogJob("clip", "v1", [])] }),
  setPartChoices: async (choices: unknown) => { if (failPush) throw new Error("down"); pushed.push(choices); return {}; },
}) as unknown as StackClient;

beforeEach(() => { resetDb(); audiences = []; pushed = []; failPush = false; __setStackClientForTests(stack()); });
afterEach(() => { __resetStackEngineForTests(); });

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}
type Row = { id: string; order: string[]; models: Array<{ id: string; label: string; description: string; rank: number; state: string }> };
const read = async (client: TestClient) => (await (await client.get("/api/ai/feature-models")).json()) as { audience: string; features: Row[] };

describe("feature models", () => {
  test("lists, per feature, only the parts that serve it (or that are already on this computer), in the Stack's order, with the Stack's words", async () => {
    const body = await read(await owner());
    const pictures = body.features.find((row) => row.id === "pictures")!;
    // p3 has no pack for this feature and is not installed, so it is not offered; p4 is installed, so the household already runs it.
    expect(pictures.models.map((model) => model.id)).toEqual(["p1", "p2", "p4"]);
    expect(pictures.models.map((model) => model.rank)).toEqual([1, 2, 3]);
    expect(pictures.models[0]).toMatchObject({ label: "Label p1", description: "Does p1.", state: "ready" });
    expect(body.features.find((row) => row.id === "videos")!.models.map((model) => model.id)).toEqual(["v1"]);
    expect(body.features.find((row) => row.id === "music")!.models.map((model) => model.id)).toEqual(["m1"]);
    expect(body.audience).toBe("adult");
    expect(audiences).toEqual(["adult"]);
  });
  test("the household's order puts its ids first and the Stack's priority follows", async () => {
    const client = await owner();
    expect((await client.put("/api/ai/feature-models/pictures/order", { order: ["p4"] })).status).toBe(200);
    expect(getHouseholdSettingValue("engines.pictures.order")).toEqual(["p4"]);
    expect((await read(client)).features.find((row) => row.id === "pictures")!.models.map((model) => model.id)).toEqual(["p4", "p1", "p2"]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toEqual({ pictures: { order: ["p4"], off: [] }, video: { order: [], off: [] }, music: { order: [], off: [] } });
    expect((await client.put("/api/ai/feature-models/pictures/order", { order: [] })).status).toBe(200);
    expect((await read(client)).features.find((row) => row.id === "pictures")!.models.map((model) => model.id)).toEqual(["p1", "p2", "p4"]);
  });
  test("the default order is empty and reading writes nothing", async () => {
    const client = await owner();
    const before = getHouseholdSettingValue("engines.pictures.order");
    await read(client);
    expect(before).toEqual([]);
    expect(pushed).toHaveLength(0);
  });
  test("a feature with no order, or a bad list, is refused; a Stack that is down still keeps the saved order and says so", async () => {
    const client = await owner();
    expect((await client.put("/api/ai/feature-models/chat/order", { order: [] })).status).toBe(400);
    expect((await client.put("/api/ai/feature-models/pictures/order", { order: [""] })).status).toBe(400);
    failPush = true;
    expect((await client.put("/api/ai/feature-models/pictures/order", { order: ["p2"] })).status).toBe(502);
    expect(getHouseholdSettingValue("engines.pictures.order")).toEqual(["p2"]);
  });
  test("the minor list is asked for by audience, never reads the household order, and keeps the Stack's neutral words", async () => {
    await owner();
    setHouseholdSettingValue("engines.pictures.order", ["p4"]);
    const minor = await featureModels("minor");
    expect(audiences.at(-1)).toBe("minor");
    expect(minor.features.find((row) => row.id === "pictures")!.order).toEqual([]);
    expect(minor.features.find((row) => row.id === "pictures")!.models.map((model) => model.id)).toEqual(["p1", "p2", "p4"]);
  });
  test("only an owner or admin reads it", async () => {
    expect((await new TestClient().get("/api/ai/feature-models")).status).toBe(401);
  });
});
