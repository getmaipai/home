// IMGGEN-SET-01: the admin side of pictures. Owner and admin only; a style starts switched off until confirmed;
// uncertain means adult-only; the likeness box and the licence are required; the household's restriction hides
// adult-only styles from everyone; children and teens show as locked off.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { adaptersFor, dropAdapterCache } from "@/lib/pictures/adapters";
import { adapterAudiencesFor } from "@/lib/pictures/policy";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";

let fake: FakeImageStack;
beforeEach(() => { resetDb(); fake = installFakeImageStack(); });
afterEach(() => fake.restore());

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}
function form(fields: Record<string, string>, file = true): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (file) f.append("file", new File([new Uint8Array([1, 2, 3, 4])], "style.safetensors"));
  return f;
}
const GOOD = { name: "Ink Wash", licence: "apache-2.0", not_real_person: "true", all_ages: "yes", trigger_words: "inkwash, sumi" };

describe("overview", () => {
  test("lists the engine, every style with its switch and the three bands", async () => {
    const { client } = await owner();
    const body = (await (await client.get("/api/pictures/admin")).json()) as { stack: string; engine: { default_model: string; edit_ready: boolean }; adapters: Array<{ id: string; enabled: boolean; classification: string; licence: string }>; bands: Array<{ band: string; on: boolean; locked: boolean }>; adult_adapters: string };
    expect(body.stack).toBe("ok");
    expect(body.engine).toMatchObject({ default_model: "flux2-klein-4b", edit_ready: true });
    expect(body.adapters.map((a) => a.id)).toEqual(["lora-aaaaaaaaaaaaaaaa", "lora-bbbbbbbbbbbbbbbb"]);
    expect(body.adapters.find((a) => a.id === "lora-bbbbbbbbbbbbbbbb")).toMatchObject({ classification: "adult-only", licence: "No licence stated", enabled: true });
    expect(body.bands).toEqual([expect.objectContaining({ band: "children", on: true, locked: true }), expect.objectContaining({ band: "teens", on: true, locked: true }), expect.objectContaining({ band: "adults", on: true, locked: false })]);
    expect(body.adult_adapters).toBe("allowed");
  });

  test("the adults switch and the adult-style restriction show as the household set them", async () => {
    const { client } = await owner();
    setHouseholdSettingValue("generation.adults", false);
    setHouseholdSettingValue("generation.adult_adapters", "restricted");
    const body = (await (await client.get("/api/pictures/admin")).json()) as { bands: Array<{ band: string; on: boolean }>; adult_adapters: string };
    expect(body.bands.find((b) => b.band === "adults")!.on).toBe(false);
    expect(body.adult_adapters).toBe("restricted");
  });

  test("only an owner or admin may read or change anything here", async () => {
    const { client, actor } = await owner();
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.get("/api/pictures/admin")).status).toBe(403);
    expect((await client.request("/api/pictures/admin/adapters/lora-aaaaaaaaaaaaaaaa", { method: "PATCH", body: { enabled: false } })).status).toBe(403);
    expect((await client.request("/api/pictures/admin/adapters/lora-aaaaaaaaaaaaaaaa", { method: "DELETE" })).status).toBe(403);
    expect((await client.postForm("/api/pictures/admin/adapters", form(GOOD))).status).toBe(403);
    expect(fake.loraAdds).toHaveLength(0);
  });
});

describe("adding a style", () => {
  test("a file is added switched off, classed all-ages only on a plain yes, and turned on by the confirmation", async () => {
    const { client } = await owner();
    const res = await client.postForm("/api/pictures/admin/adapters", form(GOOD));
    expect(res.status).toBe(200);
    const added = ((await res.json()) as { adapter: { id: string; enabled: boolean; needs_confirmation: boolean; classification: string; sha256: string } }).adapter;
    expect(added).toMatchObject({ enabled: false, needs_confirmation: true, classification: "all-ages" });
    expect(fake.loraAdds[0]).toMatchObject({ name: "Ink Wash", licence: "apache-2.0", classification: "all-ages", trigger_words: JSON.stringify(["inkwash", "sumi"]) });
    // Not offered to anyone until it is confirmed.
    dropAdapterCache();
    expect((await adaptersFor(["all-ages", "adult-only"])).map((a) => a.id)).not.toContain(added.id);
    const on = await client.request(`/api/pictures/admin/adapters/${added.id}`, { method: "PATCH", body: { enabled: true } });
    expect(((await on.json()) as { enabled: boolean; needs_confirmation: boolean })).toMatchObject({ enabled: true, needs_confirmation: false });
    expect((await adaptersFor(["all-ages"])).map((a) => a.id)).toContain(added.id);
  });

  test("not sure and no both mean adult-only", async () => {
    const { client } = await owner();
    for (const answer of ["unsure", "no"]) {
      await client.postForm("/api/pictures/admin/adapters", form({ ...GOOD, name: `Style ${answer}`, all_ages: answer }));
    }
    expect(fake.loraAdds.map((a) => a.classification)).toEqual(["adult-only", "adult-only"]);
  });

  test("the likeness box is required", async () => {
    const { client } = await owner();
    const res = await client.postForm("/api/pictures/admin/adapters", form({ ...GOOD, not_real_person: "false" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("likeness_unconfirmed");
    expect(fake.loraAdds).toHaveLength(0);
  });

  test("a licence that is not plainly free needs the person to say they read it", async () => {
    const { client } = await owner();
    const res = await client.postForm("/api/pictures/admin/adapters", form({ ...GOOD, licence: "custom community licence" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("licence_acknowledgement_required");
    const ok = await client.postForm("/api/pictures/admin/adapters", form({ ...GOOD, licence: "custom community licence", licence_acknowledged: "true" }));
    expect(ok.status).toBe(200);
  });

  test("the Stack's refusal of a minor or a real person's likeness reaches the admin in its own words", async () => {
    fake.loraRefusal = { code: "lora_refused", error: "This style was refused: its description names a real person's likeness." };
    const { client } = await owner();
    const res = await client.postForm("/api/pictures/admin/adapters", form(GOOD));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "This style was refused: its description names a real person's likeness.", code: "lora_refused" });
  });

  test("a path on this computer is sent to the Stack as a path, for files too big for a form; a path that is not a full .safetensors path is refused", async () => {
    const { client } = await owner();
    const res = await client.postForm("/api/pictures/admin/adapters", form({ ...GOOD, path: "/Users/you/Downloads/ink-wash.safetensors" }, false));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { adapter: { enabled: boolean; needs_confirmation: boolean } }).adapter).toMatchObject({ enabled: false, needs_confirmation: true });
    expect(fake.loraAdds.at(-1)).toMatchObject({ path: "/Users/you/Downloads/ink-wash.safetensors", name: "Ink Wash" });
    const bad = await client.postForm("/api/pictures/admin/adapters", form({ ...GOOD, path: "Downloads/ink-wash.ckpt" }, false));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe("bad_path");
  });

  test("a link starts a job; the finished job brings the style in switched off", async () => {
    const { client } = await owner();
    const res = await client.postForm("/api/pictures/admin/adapters", form({ ...GOOD, url: "https://huggingface.co/x/y/resolve/main/a.safetensors" }, false));
    const { job } = (await res.json()) as { job: string };
    expect(job).toBe("lora-job-1");
    const done = (await (await client.get(`/api/pictures/admin/jobs/${job}`)).json()) as { state: string; adapter: { id: string; enabled: boolean; needs_confirmation: boolean } };
    expect(done.state).toBe("done");
    expect(done.adapter).toMatchObject({ id: "lora-eeeeeeeeeeeeeeee", enabled: false, needs_confirmation: true });
  });
});

describe("switching, restricting and removing", () => {
  test("turning a style off hides it from chat; the household can restrict adult-only styles", async () => {
    const { client } = await owner();
    await client.request("/api/pictures/admin/adapters/lora-aaaaaaaaaaaaaaaa", { method: "PATCH", body: { enabled: false } });
    expect((await adaptersFor(["all-ages", "adult-only"])).map((a) => a.id)).toEqual(["lora-bbbbbbbbbbbbbbbb"]);
    await client.request("/api/pictures/admin/adapters/lora-aaaaaaaaaaaaaaaa", { method: "PATCH", body: { enabled: true } });
    // With adult-only styles restricted, the audiences a person gets leave the adult-only one out.
    setHouseholdSettingValue("generation.adult_adapters", "restricted");
    expect(adapterAudiencesFor({ actor: (await owner()).actor, band: "adult", surface: "chat", surfaceClass: "written", spoken: false })).toEqual(["all-ages"]);
    expect((await adaptersFor(["all-ages"])).map((a) => a.id)).toEqual(["lora-aaaaaaaaaaaaaaaa"]);
  });

  test("removing a style asks the Stack to delete the file and forgets the household's switch", async () => {
    const { client } = await owner();
    const res = await client.request("/api/pictures/admin/adapters/lora-bbbbbbbbbbbbbbbb", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(fake.loras.map((l) => l.id)).toEqual(["lora-aaaaaaaaaaaaaaaa"]);
    const missing = await client.request("/api/pictures/admin/adapters/lora-bbbbbbbbbbbbbbbb", { method: "DELETE" });
    expect(missing.status).toBe(404);
  });

  test("changing a style to all-ages is the Stack's to refuse when its own description names adult content", async () => {
    const { client } = await owner();
    const res = await client.request("/api/pictures/admin/adapters/lora-bbbbbbbbbbbbbbbb", { method: "PATCH", body: { classification: "all-ages" } });
    expect(res.status).toBe(200);
    expect(fake.loras.find((l) => l.id === "lora-bbbbbbbbbbbbbbbb")!.classification).toBe("all-ages");
  });

  test("installing a model returns the install job", async () => {
    const { client } = await owner();
    const res = await client.request("/api/pictures/admin/models/install", { method: "POST", body: {} });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ job: "install-job-1", family: "flux2-klein-4b" });
  });
});
