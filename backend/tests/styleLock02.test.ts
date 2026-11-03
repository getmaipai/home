// VIDEO-SETTINGS-02 (docs/design/settings-media-2026-11-02.md section 10, LoRA note test 1 on the three Settings lists): while an adult-only style is locked,
// no route that feeds the picture style list, the video style list or Models and storage carries its name, trigger words, size, id or badge; they appear
// after the person's own unlock; they are gone again after a relock; a minor never gets them or the placeholder.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import { __setComponentsFetchForTests, type StackComponent } from "@/lib/stackComponents";
import { componentStyleAccess, pictureStyleAccess } from "@/lib/styleLock";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import { household, textOf, unlock, unlockHeader } from "./fixtures/adultLock";
import { secretLora } from "./fixtures/lora";

setDefaultTimeout(30_000);
const PIC_NAME = "Hidden example Picture";
const PIC_WORD = "hxpicword";
const PIC_ID = "lora-hhhhhhhhhhhhhhhh";
const VID_NAME = "Zebraquill Cabaret Lace";
const VID_WORD = "zqlacewear";

let video: FakeVideoStack;
let images: FakeImageStack;
let calls: string[] = [];
let videoId = "";
const comp = (over: Partial<StackComponent>): StackComponent => ({
  id: "x", label: "x", summary: "x", group: "loras", kind: "lora", state: "installed", size_bytes: 123_456, download_bytes: 0, full_bytes: 123_456, required_free_bytes: 0, plan_need: null,
  requirement: "optional", requirement_reason: null, last_used_at: null, used_by: [], depends_on: [], job: null, percent: null, failure: null, can_install: false, install_block: null,
  can_uninstall: true, uninstall_block: null, ...over,
});

beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetLoraSyncForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  video = installFakeVideoStack(); video.loras = [];
  images = installFakeImageStack();
  images.loras.push({ id: PIC_ID, name: PIC_NAME, sha256: "h".repeat(64), bytes: 777_777, base_model: "flux2-klein-4b", licence: null, source_url: null, classification: "adult-only", trigger_words: [PIC_WORD], strength_default: 1, added_at: "2026-10-17T00:00:00Z" });
  calls = [];
});
afterEach(() => { video.restore(); images.restore(); __setComponentsFetchForTests(null); __setVideoStatusForTests(undefined); });

function stackComponents() {
  __setComponentsFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/stack/v1/components" && (init?.method ?? "GET") === "GET") {
      return Response.json({ tier: "p128", free_disk_bytes: 1e12, disk_margin_bytes: 5e9, installed_bytes: 1e9, components: [
        comp({ id: "lora.picture.lora-aaaaaaaaaaaaaaaa", label: "Pixel Art" }),
        comp({ id: `lora.picture.${PIC_ID}`, label: PIC_NAME, summary: PIC_WORD }),
        comp({ id: `lora.video.${videoId}`, label: VID_NAME, summary: VID_WORD }),
        comp({ id: "z-image-turbo", label: "Pictures: Z-Image-Turbo", group: "pictures", kind: "model" }),
      ] });
    }
    return Response.json({ component: path, freed_bytes: 1, removed: true });
  }) as never);
}

const SECRETS = [PIC_NAME, PIC_WORD, PIC_ID, "Hidden example", "777777", "hhhhhhhh", VID_NAME, VID_WORD, "Zebraquill"] as const;
const PAGES = ["/api/pictures/admin", "/api/videos/settings", "/api/components"] as const;

async function setup() {
  const house = await household();
  videoId = secretLora(house.row("Sage").id, { availability: { who: "admins", people: [] } }).id;
  stackComponents();
  return house;
}

describe("the three Settings style lists", () => {
  test("locked: no secret string in any answer, one flag instead; unlocked: the styles are there; relocked: gone again", async () => {
    const { owner } = await setup();
    for (const path of PAGES) {
      const text = await textOf(await owner.get(path));
      for (const s of SECRETS) expect(text).not.toContain(s);
    }
    const pictures = (await (await owner.get("/api/pictures/admin")).json()) as { adapters: Array<{ id: string }>; locked_styles: boolean };
    expect(pictures.adapters.map((a) => a.id)).toEqual(["lora-aaaaaaaaaaaaaaaa"]);
    expect(pictures.locked_styles).toBe(true);
    expect(((await (await owner.get("/api/videos/settings")).json()) as { locked_styles: boolean }).locked_styles).toBe(true);
    const parts = (await (await owner.get("/api/components")).json()) as { components: Array<{ id: string }>; locked_styles: boolean };
    expect(parts.components.map((c) => c.id)).toEqual(["lora.picture.lora-aaaaaaaaaaaaaaaa", "z-image-turbo"]);
    expect(parts.locked_styles).toBe(true);

    const proof = await unlock(owner, "correcthorse");
    const h = unlockHeader(proof);
    const open = await textOf(await owner.get("/api/pictures/admin", h));
    expect(open).toContain(PIC_NAME);
    expect(open).toContain(PIC_WORD);
    expect(((await (await owner.get("/api/pictures/admin", h)).json()) as { locked_styles: boolean }).locked_styles).toBe(false);
    expect(await textOf(await owner.get("/api/videos/settings", h))).toContain(VID_NAME);
    const openParts = await textOf(await owner.get("/api/components", h));
    expect(openParts).toContain(PIC_NAME);
    expect(openParts).toContain(VID_NAME);

    // Leaving the page relocks: the same header no longer counts.
    expect((await owner.post("/api/adult-lock/lock", {}, h)).status).toBeLessThan(300);
    for (const path of PAGES) {
      const text = await textOf(await owner.get(path, h));
      for (const s of SECRETS) expect(text).not.toContain(s);
    }
  });

  test("a locked style cannot be changed, removed or installed through these routes, and the Stack is never asked", async () => {
    const { owner } = await setup();
    const quiet = async (res: Response) => { expect(res.status).toBe(404); const text = await textOf(res); for (const s of SECRETS) expect(text).not.toContain(s); };
    await quiet(await owner.request(`/api/pictures/admin/adapters/${PIC_ID}`, { method: "PATCH", body: { enabled: true } }));
    await quiet(await owner.request(`/api/pictures/admin/adapters/${PIC_ID}`, { method: "DELETE" }));
    await quiet(await owner.request(`/api/components/lora.picture.${PIC_ID}`, { method: "DELETE" }));
    await quiet(await owner.request(`/api/components/lora.video.${videoId}`, { method: "DELETE" }));
    await quiet(await owner.request(`/api/components/lora.picture.${PIC_ID}/install`, { method: "POST", body: {} }));
    expect(calls.filter((c) => c.startsWith("DELETE") || c.includes("install"))).toEqual([]);
    expect(images.loras.some((l) => l.id === PIC_ID)).toBe(true);
    const h = unlockHeader(await unlock(owner, "correcthorse"));
    expect((await owner.request(`/api/components/lora.picture.${PIC_ID}`, { method: "DELETE", headers: h })).status).toBe(200);
  });

  test("a style Home cannot place is locked, not drawn (fail closed)", async () => {
    const { owner } = await setup();
    __setComponentsFetchForTests((async () => Response.json({ tier: null, free_disk_bytes: 1, disk_margin_bytes: 0, installed_bytes: 0, components: [comp({ id: "lora.video.lora-unknown0000000", label: "Mystery Name" }), comp({ id: "odd-id", label: "Odd Name", group: "loras" })] })) as never);
    const text = await textOf(await owner.get("/api/components"));
    expect(text).not.toContain("Mystery Name");
    expect(text).not.toContain("Odd Name");
    expect(JSON.parse((await (await owner.get("/api/components")).text())).locked_styles).toBe(true);
  });

  test("a minor never gets the styles or the placeholder: the routes refuse them, and the decision itself answers hidden, never locked", async () => {
    const { teen, child, owner, row } = await setup();
    for (const person of [teen, child]) for (const path of PAGES) {
      const res = await person.client.get(path);
      expect(res.status).toBe(403);
      const body = await res.text();
      for (const s of SECRETS) expect(body).not.toContain(s);
      expect(body).not.toContain("locked_styles");
    }
    const proof = unlockHeader(await unlock(owner, "correcthorse"));
    expect((await owner.get("/api/pictures/admin", proof)).status).toBe(200);
    for (const name of ["Nova", "Sprout"]) {
      expect(pictureStyleAccess(row(name), "adult-only")).toBe("hidden");
      expect(await componentStyleAccess(row(name), `lora.picture.${PIC_ID}`)).toBe("hidden");
      expect(await componentStyleAccess(row(name), `lora.video.${videoId}`)).toBe("hidden");
    }
  });

  test("a style Home already holds as adult-only stays adult-only: no route lowers the class on a read", async () => {
    const { owner } = await setup();
    await owner.get("/api/pictures/admin");
    await owner.get("/api/components");
    expect(images.loras.find((l) => l.id === PIC_ID)!.classification).toBe("adult-only");
  });
});
