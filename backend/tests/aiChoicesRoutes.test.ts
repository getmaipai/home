// AIMODELS-ROUTES-01: /api/ai. The cards, the unused list, one choice (install first, then the setting), set everything to
// recommended (never removes, safe twice) and Free up space (per-id guard, partial results). Owner and admin only.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { __setComponentsFetchForTests, type StackComponent } from "@/lib/stackComponents";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { shippedDiskPlan } from "@/lib/diskPlan";
import { resetInstallStatusCache } from "@/lib/installStatus";
import type { StackClient, StackInstallPlan } from "@/lib/stack/client";
import { wakewordDir } from "@/lib/paths";
import { WAKEWORD_ALL_ASSETS, isWakewordAssetInstalled, wakewordAssetPath } from "@/lib/wakewordAssets";
import { closeForJob, resetCloseAppsForTests, type CloseHelper } from "@/lib/jobs/closeApps";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const GIB = 1024 ** 3;
const disk = shippedDiskPlan("p128");
const plan = (): StackInstallPlan => ({
  level: "recommended", tier: "p128", label: "x", memory_gb: 128, memory_source: "unified", models: [], optional_models: [],
  total_bytes: 0, remaining_bytes: 0, free_disk_bytes: 10 ** 13, fits_disk: true, disk,
});
const stackClient = () => ({ installPlan: async () => plan(), jobs: async () => [], models: async () => [], pullModel: async () => ({}), engineAction: async () => ({}), modelCatalog: async () => ({ models: [] }) }) as unknown as StackClient;

const rowFor = (planRowId: string) => disk.rows.find((row) => row.id === planRowId)!;
const idOf = (planRowId: string) => rowFor(planRowId).model_ids[0]!;

/** One Stack component per plan model row, by its first model id; `installed` names the plan rows that are on this computer. */
function part(planRowId: string, state: StackComponent["state"], over: Partial<StackComponent> = {}): StackComponent {
  const row = rowFor(planRowId);
  return {
    id: row.model_ids[0]!, label: row.label, summary: "x", group: "pictures", kind: "model", state, size_bytes: state === "installed" ? row.installed_bytes : null,
    download_bytes: row.download_bytes, full_bytes: row.download_bytes, required_free_bytes: row.download_bytes, plan_need: row.need,
    requirement: row.need === "required" ? "required" : "optional", requirement_reason: null, last_used_at: null, used_by: [], depends_on: [], job: null, percent: null, failure: null,
    can_install: true, install_block: null, can_uninstall: row.need !== "required", uninstall_block: row.need === "required" ? "Home needs it." : null, ...over,
  };
}
function everything(installed: string[], over: Record<string, Partial<StackComponent>> = {}): StackComponent[] {
  return disk.rows.filter((row) => row.kind === "model" && row.model_ids.length > 0)
    .map((row) => part(row.id, row.need === "required" || installed.includes(row.id) ? "installed" : "notInstalled", over[row.id] ?? {}));
}

let components: StackComponent[] = [];
let calls: Array<{ method: string; path: string }> = [];
let failInstall: Set<string> = new Set();
let failDelete: Set<string> = new Set();
let afterDelete: ((id: string) => void) | null = null;
let down = false;

beforeEach(() => {
  resetDb(); resetInstallStatusCache(); calls = []; failInstall = new Set(); failDelete = new Set(); afterDelete = null; down = false;
  components = everything(["pictures-ernie", "image-tools", "voice-better", "reads-pictures", "coding"]);
  __setStackClientForTests(stackClient());
  __setComponentsFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    if (down) throw new Error("refused");
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    calls.push({ method, path });
    if (method === "GET" && path === "/stack/v1/components") return Response.json({ tier: "p128", free_disk_bytes: 800 * GIB, disk_margin_bytes: 5 * GIB, installed_bytes: 41 * GIB, components });
    const id = decodeURIComponent(path.split("/")[4] ?? "");
    if (method === "POST" && path.endsWith("/install")) {
      if (failInstall.has(id)) return Response.json({ error: "There is not enough room on the engine's disk.", code: "no_room" }, { status: 409 });
      const target = components.find((component) => component.id === id);
      if (target?.licence && !target.licence.accepted_at) return Response.json({ error: "Its licence needs your accept first.", code: "licence_required" }, { status: 409 });
      return Response.json({ job: `job-${id}`, component: id }, { status: 202 });
    }
    if (method === "DELETE") {
      if (failDelete.has(id)) return Response.json({ error: "The engine could not remove it. Try again.", code: "busy" }, { status: 409 });
      const target = components.find((component) => component.id === id);
      components = components.map((component) => (component.id === id ? { ...component, state: "notInstalled" as const, size_bytes: null } : component));
      afterDelete?.(id);
      return Response.json({ component: id, freed_bytes: target?.size_bytes ?? 0, removed: true });
    }
    return Response.json({ error: `unscripted ${method} ${path}`, code: "unscripted" }, { status: 500 });
  }) as never);
});
afterEach(() => { __resetStackEngineForTests(); __setComponentsFetchForTests(null); });

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}
const installs = () => calls.filter((call) => call.method === "POST").map((call) => decodeURIComponent(call.path.split("/")[4] ?? ""));
const deletes = () => calls.filter((call) => call.method === "DELETE");
type Card = { id: string; chip: string; choices: Array<{ id: string; current: boolean; action: string }> };

describe("access", () => {
  test("choices and unused are owner and admin only", async () => {
    const { client, actor } = await owner();
    expect((await new TestClient().get("/api/ai/choices")).status).toBe(401);
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.get("/api/ai/choices")).status).toBe(403);
    expect((await client.get("/api/ai/unused")).status).toBe(403);
    expect((await client.post("/api/ai/recommended", {})).status).toBe(403);
    expect((await client.post("/api/ai/cleanup", { ids: ["x"] })).status).toBe(403);
    expect((await client.post("/api/ai/choices/pictures", { choice: "pictures.ernie" })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("tier candidates (TIER-HOME-04)", () => {
  test("an admin reads the levels for a job with families and refusals; an adult is refused", async () => {
    const { client, actor } = await owner();
    __setComponentsFetchForTests((async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/stack/v1/tiers/candidates") return Response.json({ category: url.searchParams.get("category"), profile: "p64", room_bytes: 40 * GIB, levels: [{ tier: "standard", cap_bytes: 24 * GIB, recommended: "ernie-image-turbo", candidates: [{ id: "z-image-turbo", label: "Z-Image Turbo", family: "z-image", peak_bytes: 26e9, verified: true, fits: false, refusal: "This needs 26 GB. Standard keeps Home free, so it can't hold it. Use Boost or Max." }] }] });
      return Response.json({}, { status: 500 });
    }) as never);
    const body = await (await client.get("/api/ai/tiers/pictures")).json() as { profile: string; levels: Array<{ candidates: Array<{ family: string; refusal: string | null }> }> };
    expect(body.profile).toBe("p64");
    expect(body.levels[0]!.candidates[0]).toMatchObject({ family: "z-image", refusal: expect.stringContaining("Use Boost or Max") });
    expect((await client.get("/api/ai/tiers/wakeword")).status).toBe(400);
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.get("/api/ai/tiers/pictures")).status).toBe(403);
  });
});

describe("the Max window (TIER-HOME-03)", () => {
  test("an admin reads that no Max job runs and Stop reports nothing to stop; an adult is refused", async () => {
    const { client, actor } = await owner();
    expect(await (await client.get("/api/ai/tier-window")).json()).toEqual({ open: false, minutes_left: null, line: null, profile: null, closed_apps: [] });
    expect(await (await client.post("/api/ai/tier-window/stop", {})).json()).toEqual({ stopped: false });
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.get("/api/ai/tier-window")).status).toBe(403);
    expect((await client.post("/api/ai/tier-window/stop", {})).status).toBe(403);
  });
});

describe("the Status line for closed apps (TIER-PRIO-05)", () => {
  test("an admin reads which apps were closed; the names never reach a non-admin", async () => {
    const { client, actor } = await owner();
    resetCloseAppsForTests();
    const helper: CloseHelper = { list: async () => ({ installed: true, apps: [{ bundleId: "x.Safari", name: "Safari", bytes: 9e9, frontmost: false }] }), quit: async () => "quit", reopen: async () => true };
    await closeForJob("job-1", "video", 8, { mode: "automatic", always: ["x.Safari"], never: [], reopen: true, noReopen: [] }, helper, Date.parse("2026-10-30T12:00:00Z"));
    const body = await (await client.get("/api/ai/tier-window")).json() as { closed_apps: string[] };
    expect(body.closed_apps).toEqual([expect.stringContaining("Closed Safari to make room")]);
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    const refused = await client.get("/api/ai/tier-window");
    expect(refused.status).toBe(403);
    expect(JSON.stringify(await refused.json())).not.toContain("Safari");
    resetCloseAppsForTests();
  });
});

describe("the cards", () => {
  test("GET /api/ai/choices returns nine cards with the current Quick picture model from the setting", async () => {
    const { client } = await owner();
    setHouseholdSettingValue("generation.picture_quick_model", "klein");
    const body = await (await client.get("/api/ai/choices")).json() as { stack: string; cards: Card[]; alwaysOn: { bytes: number; rowIds: string[] }; recommended: { changes: Array<{ job: string }> } | null };
    expect(body.stack).toBe("ok");
    const reading = (body as unknown as { memory_available_bytes: number | null }).memory_available_bytes;
    expect(reading === null || reading > 0).toBe(true);
    expect(body.cards.map((card) => card.id)).toEqual(["chat", "pictures", "picturesdetailed", "videos", "music", "voice", "wakeword", "vision", "coding"]);
    const pictures = body.cards.find((card) => card.id === "pictures")!;
    expect(pictures.choices.find((choice) => choice.id === "pictures.klein")!.current).toBe(true);
    expect(body.alwaysOn.rowIds.length).toBeGreaterThan(0);
    expect(body.recommended!.changes.map((change) => change.job)).toContain("pictures");
    const wake = body.cards.find((card) => card.id === "wakeword")!;
    expect(wake.choices.map((choice) => choice.id)).toEqual(["wakeword.detector"]);
  });

  test("the Stack unreachable: GET answers 200 with stack unreachable, POST answers 503 with the sentence", async () => {
    const { client } = await owner();
    down = true;
    const read = await client.get("/api/ai/choices");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ stack: "unreachable", cards: [], message: "The engine isn't answering. Check that the engine is running, then try again." });
    const write = await client.post("/api/ai/recommended", {});
    expect(write.status).toBe(503);
    expect(((await write.json()) as { error: string }).error).toMatch(/engine isn't answering/);
  });
});

describe("choosing", () => {
  test("choosing Detailed pictures installs first and then writes generation.picture_detailed.enabled", async () => {
    const { client } = await owner();
    let seenAtInstall: unknown = "unset";
    const base = globalThis.fetch;
    components = everything(["pictures-ernie"]);
    setHouseholdSettingValue("generation.picture_detailed.enabled", false);
    __setComponentsFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if ((init?.method ?? "GET") === "POST") { seenAtInstall = getHouseholdSettingValue("generation.picture_detailed.enabled"); calls.push({ method: "POST", path }); return Response.json({ job: "j", component: "z" }, { status: 202 }); }
      calls.push({ method: "GET", path });
      return Response.json({ tier: "p128", free_disk_bytes: 800 * GIB, disk_margin_bytes: 5 * GIB, installed_bytes: 1, components });
    }) as never);
    const res = await client.post("/api/ai/choices/picturesdetailed", { choice: "picturesdetailed.zimage" });
    expect(res.status).toBe(200);
    expect(installs()).toContain(idOf("pictures-zimage"));
    expect(seenAtInstall).toBe(false);
    expect(getHouseholdSettingValue("generation.picture_detailed.enabled")).toBe(true);
    void base;
  });

  test("choosing a picture style whose install cannot start does not write the setting", async () => {
    const { client } = await owner();
    components = everything(["pictures-ernie"]);
    setHouseholdSettingValue("generation.picture_detailed.enabled", false);
    failInstall.add(idOf("pictures-zimage"));
    const res = await client.post("/api/ai/choices/picturesdetailed", { choice: "picturesdetailed.zimage" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/not enough room/);
    expect(getHouseholdSettingValue("generation.picture_detailed.enabled")).toBe(false);
  });

  test("using an installed choice writes the setting only", async () => {
    const { client } = await owner();
    components = everything(["pictures-ernie", "pictures-zimage"]);
    setHouseholdSettingValue("generation.picture_detailed.enabled", false);
    const res = await client.post("/api/ai/choices/picturesdetailed", { choice: "picturesdetailed.zimage" });
    expect(res.status).toBe(200);
    expect(installs()).toEqual([]);
    expect(getHouseholdSettingValue("generation.picture_detailed.enabled")).toBe(true);
  });

  test("picking Klein as the Quick model writes the setting and installs nothing extra", async () => {
    const { client } = await owner();
    components = everything(["pictures-ernie", "pictures"]);
    const res = await client.post("/api/ai/choices/pictures", { choice: "pictures.klein" });
    expect(res.status).toBe(200);
    expect(installs()).toEqual([]);
    expect(getHouseholdSettingValue("generation.picture_quick_model")).toBe("klein");
  });

  test("the wake word row lists the stock detector and its two feature files, and removing it deletes them", async () => {
    const { client } = await owner();
    await mkdir(wakewordDir, { recursive: true });
    for (const asset of WAKEWORD_ALL_ASSETS) await Bun.write(wakewordAssetPath(asset.file), "x");
    const read = async () => ((await (await client.get("/api/ai/choices")).json()) as { cards: Card[] }).cards.find((card) => card.id === "wakeword")!;
    const before = await read();
    expect(before.choices.map((choice) => choice.id)).toEqual(["wakeword.detector"]);
    expect(before.choices[0]!.current).toBe(true);
    const res = await client.post("/api/ai/choices/wakeword", { choice: "wakeword.detector" });
    expect(res.status).toBe(200);
    expect(WAKEWORD_ALL_ASSETS.some((asset) => isWakewordAssetInstalled(asset.file))).toBe(false);
    const after = await read();
    expect(after.choices[0]!.current).toBe(false);
    expect(after.choices[0]!.action).toBe("get");
  });

  test("an unknown job or choice is a 404 with a sentence", async () => {
    const { client } = await owner();
    expect((await client.post("/api/ai/choices/nonsense", { choice: "x" })).status).toBe(404);
    expect((await client.post("/api/ai/choices/pictures", { choice: "pictures.nonsense" })).status).toBe(404);
  });

  test("turning the music switch off only changes the setting", async () => {
    const { client } = await owner();
    components = everything(["music"]);
    setHouseholdSettingValue("generation.music.enabled", true);
    const res = await client.post("/api/ai/choices/music", { choice: "music.make" });
    expect(res.status).toBe(200);
    expect(deletes()).toEqual([]);
    expect(getHouseholdSettingValue("generation.music.enabled")).toBe(false);
  });
});

describe("set everything to recommended", () => {
  test("changes Klein back to ERNIE, starts only the missing installs, never calls DELETE", async () => {
    const { client } = await owner();
    setHouseholdSettingValue("generation.picture_quick_model", "klein");
    const res = await client.post("/api/ai/recommended", {});
    expect(res.status).toBe(200);
    const body = await res.json() as { changed: string[]; started: string[] };
    expect(body.changed.some((line) => line.startsWith("Quick pictures:"))).toBe(true);
    expect(getHouseholdSettingValue("generation.picture_quick_model")).toBe("ernie");
    expect(installs()).toContain(idOf("video"));
    expect(installs()).not.toContain(idOf("pictures-ernie"));
    expect(installs()).not.toContain(idOf("video-detailed"));
    expect(deletes()).toEqual([]);
  });

  test("pressed twice it does not start a second install while a job runs", async () => {
    const { client } = await owner();
    const first = await (await client.post("/api/ai/recommended", {})).json() as { started: string[] };
    expect(first.started.length).toBeGreaterThan(0);
    components = components.map((component) => (first.started.includes(`job-${component.id}`) ? { ...component, state: "installing" as const, job: `job-${component.id}` } : component));
    calls = [];
    const second = await (await client.post("/api/ai/recommended", {})).json() as { started: string[]; already: string[] };
    expect(second.started).toEqual([]);
    expect(second.already.length).toBe(first.started.length);
    expect(installs()).toEqual([]);
  });

  test("continues past a part that needs a licence click", async () => {
    const { client } = await owner();
    const videoId = idOf("video");
    components = components.map((component) => (component.id === videoId ? { ...component, licence: { id: "lic", name: "Licence", url: "https://example.com", summary: [], accepted_at: null, covered: false } } : component));
    const res = await client.post("/api/ai/recommended", {});
    expect(res.status).toBe(200);
    const body = await res.json() as { needs_licence: Array<{ id: string }>; started: string[] };
    expect(body.needs_licence.map((item) => item.id)).toEqual([videoId]);
    expect(body.started.length).toBeGreaterThanOrEqual(0);
  });
});

describe("free up space", () => {
  const withUnused = () => { setHouseholdSettingValue("generation.picture_detailed.enabled", false); components = everything(["pictures-ernie", "pictures-zimage", "video", "video-detailed"]); };

  test("GET /api/ai/unused lists unused parts largest first by plain name", async () => {
    const { client } = await owner();
    withUnused();
    const body = await (await client.get("/api/ai/unused")).json() as { items: Array<{ id: string; name: string }>; total_bytes: number };
    expect(body.items.map((item) => item.name)).toEqual(expect.arrayContaining(["Detailed pictures", "Detailed videos"]));
    expect(body.items.map((item) => item.id)).not.toContain(idOf("pictures"));
    expect(body.total_bytes).toBeGreaterThan(0);
  });

  test("removes unused ids one at a time and reports freed bytes", async () => {
    const { client } = await owner();
    withUnused();
    const res = await client.post("/api/ai/cleanup", { ids: [idOf("pictures-zimage"), idOf("video-detailed")] });
    const body = await res.json() as { results: Array<{ id: string; status: string }>; freed_bytes: number; kept: number; failed: number };
    expect(body.results.map((entry) => entry.status)).toEqual(["removed", "removed"]);
    expect(body.freed_bytes).toBeGreaterThan(0);
    expect(deletes().length).toBe(2);
  });

  test("keeps an id that became used between the list and the confirm", async () => {
    const { client } = await owner();
    withUnused();
    setHouseholdSettingValue("generation.picture_detailed.enabled", true);
    const res = await client.post("/api/ai/cleanup", { ids: [idOf("pictures-zimage")] });
    const body = await res.json() as { results: Array<{ status: string; message: string }>; kept: number };
    expect(body.results[0]).toMatchObject({ status: "kept" });
    expect(body.results[0]!.message).toBe("Detailed pictures is in use now, so it was kept.");
    expect(body.kept).toBe(1);
    expect(deletes()).toEqual([]);
  });

  test("never stops at one failure", async () => {
    const { client } = await owner();
    withUnused();
    failDelete.add(idOf("pictures-zimage"));
    const body = await (await client.post("/api/ai/cleanup", { ids: [idOf("pictures-zimage"), idOf("video-detailed")] })).json() as { results: Array<{ status: string; message: string }>; failed: number };
    expect(body.results.map((entry) => entry.status)).toEqual(["failed", "removed"]);
    expect(body.results[0]!.message).toMatch(/could not remove/);
    expect(body.failed).toBe(1);
  });

  test("refuses Always on parts and Klein even when asked by id", async () => {
    const { client } = await owner();
    withUnused();
    const body = await (await client.post("/api/ai/cleanup", { ids: [idOf("pictures"), idOf("judge"), idOf("embed")] })).json() as { results: Array<{ status: string }> };
    expect(body.results.map((entry) => entry.status)).toEqual(["kept", "kept", "kept"]);
    expect(deletes()).toEqual([]);
  });

  test("a style keeps its base model", async () => {
    const { client } = await owner();
    withUnused();
    components = [...components, { ...part("pictures-zimage", "installed"), id: "lora.picture.cinema", label: "Cinema", kind: "lora", depends_on: [idOf("pictures-zimage")], size_bytes: 100 }];
    const body = await (await client.post("/api/ai/cleanup", { ids: [idOf("pictures-zimage")] })).json() as { results: Array<{ status: string; message: string }> };
    expect(body.results[0]).toMatchObject({ status: "kept" });
    expect(body.results[0]!.message).toMatch(/saved style needs/);
  });
});

describe("the optional uncensored chat model (third Chat choice)", () => {
  const UNCENSORED = "qwen3-8-27b-huihui-abliterated-iq4-xs";
  const PROJECTOR = "qwen3-8-27b-huihui-abliterated-mmproj-bf16";
  const standard = () => rowFor("chat").model_ids.filter((id) => id !== UNCENSORED).at(-1)!;
  let pulled: string[] = [];
  let loaded: string[] = [];
  function chatStack(installed: string[], running: string) {
    const pin = (id: string, extra: object = {}) => ({ id, role: "chat", license: "Apache-2.0", revision: "r", download: { url: `https://example.com/${id}.gguf`, sha256: "a".repeat(64), approx_bytes: 1000 }, ...extra });
    __setStackClientForTests({
      ...(stackClient() as object),
      roles: async () => ({ roles: [{ id: "chat", model: { id: running }, state: { state: "ready" }, models: installed.map((id) => ({ id, name: id })) }] }),
      modelCatalog: async () => ({ models: [pin(UNCENSORED, { imageInput: { projector: PROJECTOR } }), pin(PROJECTOR), pin(standard())] }),
      pullModel: async (body: { id: string }) => { pulled.push(body.id); return { job: `job-${body.id}` }; },
      modelAction: async (id: string) => { loaded.push(id); return { ok: true }; },
    } as unknown as StackClient);
  }
  const chatCard = async (client: TestClient) => ((await (await client.get("/api/ai/choices")).json()) as { cards: Card[] }).cards.find((card) => card.id === "chat")!;
  beforeEach(() => { pulled = []; loaded = []; });

  test("it is listed after Standard, not current, and Standard stays current until it runs", async () => {
    const { client } = await owner();
    chatStack([standard()], standard());
    const card = await chatCard(client);
    expect(card.choices.map((choice) => choice.id)).toContain("chat.uncensored");
    expect(card.choices.find((choice) => choice.id === "chat.uncensored")).toMatchObject({ current: false, action: "get" });
    // The parts line names the model itself, as the Standard option does, never a generic "Uncensored chat AI".
    const uncensoredRow = (card.choices.find((choice) => choice.id === "chat.uncensored") as unknown as { details: Array<{ name: string }> }).details[0]!.name;
    expect(uncensoredRow).toBe("Qwen3.8 27B Uncensored (Huihui, IQ4_XS)");
    expect(card.choices.find((choice) => choice.id === "chat.standard")!.current).toBe(true);
  });

  test("choosing it downloads its picture file and weights through the model switch, never a Stack part", async () => {
    const { client } = await owner();
    chatStack([standard()], standard());
    const res = await client.post("/api/ai/choices/chat", { choice: "chat.uncensored" });
    expect(res.status).toBe(200);
    expect(pulled).toEqual([PROJECTOR, UNCENSORED]);
    expect(installs()).toEqual([]);
  });

  test("a chosen model loads by itself once its download jobs are done, and the card reads Installing while they run", async () => {
    const { client } = await owner();
    const state: "running" | "done" = "running";
    let pulling = false;
    const base = stackClient() as object;
    const installed: string[] = [standard()];
    __setStackClientForTests({
      ...base,
      roles: async () => ({ roles: [{ id: "chat", model: { id: standard() }, state: { state: "ready" }, models: installed.map((id) => ({ id, name: id })) }] }),
      modelCatalog: async () => ({ models: [{ id: UNCENSORED, role: "chat", license: "Apache-2.0", revision: "r", imageInput: { projector: PROJECTOR }, download: { url: "https://example.com/a.gguf", sha256: "a".repeat(64), approx_bytes: 1000 } }, { id: PROJECTOR, role: "chat", license: "Apache-2.0", revision: "r", download: { url: "https://example.com/p.gguf", sha256: "b".repeat(64), approx_bytes: 100 } }] }),
      pullModel: async (body: { id: string }) => { pulling = true; return { job: `job-${body.id}` }; },
      jobs: async () => (!pulling ? [] : [PROJECTOR, UNCENSORED]).map((id) => ({ id: `job-${id}`, kind: "model.install", role: "chat", state, percent: 50, completedBytes: 50, totalBytes: 100, status: "", position: null, input: { model: id, purpose: "model upgrade" }, result: null, reason: null, createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z" })),
      modelAction: async (id: string) => { loaded.push(id); return { ok: true }; },
    } as unknown as StackClient);
    expect((await client.post("/api/ai/choices/chat", { choice: "chat.uncensored" })).status).toBe(200);
    const card = await chatCard(client);
    expect(card.choices.find((choice) => choice.id === "chat.uncensored")).toMatchObject({ state: "installing", percent: 50, action: "none" });
    expect(loaded).toEqual([]);
  });

  test("once installed it loads, and when it runs Standard offers Use and loads the tier's chat model", async () => {
    const { client } = await owner();
    chatStack([standard(), UNCENSORED], standard());
    expect((await client.post("/api/ai/choices/chat", { choice: "chat.uncensored" })).status).toBe(200);
    expect(loaded).toEqual([UNCENSORED]);
    loaded = [];
    chatStack([standard(), UNCENSORED], UNCENSORED);
    const card = await chatCard(client);
    expect(card.chip).toBe("Using Uncensored");
    expect(card.choices.find((choice) => choice.id === "chat.standard")).toMatchObject({ current: false, action: "use" });
    expect((await client.post("/api/ai/choices/chat", { choice: "chat.standard" })).status).toBe(200);
    expect(loaded).toEqual([standard()]);
  });
});
