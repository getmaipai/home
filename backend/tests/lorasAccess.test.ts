// STACK-LORAS-01 slice 6: the access, route and leak tests of the old loras03 file, kept after the table and its writer went (the Stack holds the records; docs/dev/loras.md, docs/design/video-loras-2026-11-02.md sections 4, 7 and 11): the `Lora` records, the one access function, the admin routes,
// the migration of the old preference rows, the auto-mark with a LoRA, the Stack wiring behind its flag, and the leak sweep while an adult-only style is locked.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { __resetAdultLockForTests, issueProof, type AdultProof } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { loraAccess, readLoras, type LoraAccess, type LoraSurface } from "@/lib/loras/access";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { usesAdultOnlyStyle } from "@/lib/videos/adultStyle";
import { wireLoras, LORAS_UNSUPPORTED_LINE } from "@/lib/videos/loraWire";
import { startVideoJob } from "@/lib/videos/jobs";
import { LTX25_MODEL } from "@/lib/videos/quality";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { setHouseholdSettingValue } from "@/lib/settings";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { household, textOf, unlock, unlockHeader } from "./fixtures/adultLock";
import { SECRET_STRINGS, loraRecord, putLora, secretLora } from "./fixtures/lora";
import type { PersonRow } from "@/types";

setDefaultTimeout(30_000);
let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  fake.loras = []; // the tests below make their own records unless they say otherwise
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); setHouseholdSettingValue("generation.styles.adult_only", "allowed"); });

const proofFor = (person: PersonRow): AdultProof => ({ token: issueProof(person.id, "test-session", "t").proof, sessionKey: "test-session" });
const NONE: AdultProof = { token: null, sessionKey: null };

describe("loraAccess: the table of section 7, cell by cell", () => {
  test("every person x availability x audience x surface x proof", async () => {
    const { row } = await household();
    const [admin, marlow, quill, teen, child] = [row("Sage"), row("Marlow"), row("Quill"), row("Nova"), row("Sprout")];
    const availabilities: Array<{ label: string; who: "admins" | "adults" | "people"; people: string[]; usableBy: (p: PersonRow) => boolean }> = [
      { label: "admins", who: "admins", people: [], usableBy: (p) => p.id === admin.id },
      { label: "adults", who: "adults", people: [], usableBy: (p) => [admin.id, marlow.id, quill.id].includes(p.id) },
      { label: "people[marlow]", who: "people", people: [marlow.id], usableBy: (p) => [admin.id, marlow.id].includes(p.id) },
    ];
    let cells = 0;
    for (const avail of availabilities) for (const audience of ["all-ages", "adult-only"] as const) {
      const lora = putLora(admin.id, { audience, audience_set_by: audience === "all-ages" ? admin.id : null, audience_set_at: audience === "all-ages" ? "2026-11-02T00:00:00.000Z" : null, availability: { who: avail.who, people: avail.people } });
      for (const person of [admin, marlow, quill, teen, child]) for (const surface of ["own_written", "shared", "spoken"] as LoraSurface[]) for (const proved of [false, true]) {
        const proof = proved ? proofFor(person) : NONE;
        const expected: LoraAccess = ["teen", "child"].includes(person.role) || surface !== "own_written" || !avail.usableBy(person) ? "hidden" : audience === "all-ages" || proved ? "open" : "locked";
        expect(loraAccess(person, lora, surface, proof)).toBe(expected);
        cells += 1;
      }
    }
    expect(cells).toBe(3 * 2 * 5 * 3 * 2);
  });

  test("a guest is hidden everything, and the household's adult-only switch hides adult-only styles from everyone, admins included", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const open = putLora(admin.id, { availability: { who: "adults", people: [] } });
    const adultOnly = putLora(admin.id, { audience: "adult-only", audience_set_by: null, audience_set_at: null });
    const guest = { ...row("Marlow"), role: "guest" } as PersonRow;
    expect(loraAccess(guest, open, "own_written", proofFor(guest))).toBe("hidden");
    expect(loraAccess(admin, adultOnly, "own_written", proofFor(admin))).toBe("open");
    setHouseholdSettingValue("generation.styles.adult_only", "restricted");
    expect(loraAccess(admin, adultOnly, "own_written", proofFor(admin))).toBe("hidden");
    expect(loraAccess(admin, open, "own_written", proofFor(admin))).toBe("open");
  });

  test("removed styles are hidden from everyone but an admin's Recently removed", async () => {
    const { row } = await household();
    const admin = row("Sage"); const marlow = row("Marlow");
    putLora(admin.id, { availability: { who: "adults", people: [] }, removed_at: "2026-11-02T00:00:00.000Z", trash_until: "2026-12-02T00:00:00.000Z" });
    expect(readLoras(marlow, "own_written").items).toEqual([]);
    expect(readLoras(admin, "own_written").items).toEqual([]);
    expect(readLoras(admin, "own_written", { removed: true }).items).toHaveLength(1);
    expect(readLoras(marlow, "own_written", { removed: true }).items).toEqual([]);
  });
});

describe("routes", () => {
  test("a child and a teen are never told a style exists; a guest-free household: only an owner or admin reaches the library routes", async () => {
    const { owner, adult, teen, child, row } = await household();
    const admin = row("Sage");
    putLora(admin.id, { availability: { who: "adults", people: [] } });
    for (const who of [teen, child]) {
      const res = await who.client.get("/api/loras/available");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: [], locked: false });
      expect((await who.client.get("/api/loras")).status).toBe(403);
    }
    expect((await adult.client.get("/api/loras")).status).toBe(403);
    expect(((await (await adult.client.get("/api/loras/available")).json()) as { items: unknown[] }).items).toHaveLength(1);
    expect(((await (await owner.get("/api/loras")).json()) as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe("leak test: an adult-only style's name, trigger, add-in, hash and preview never appear while it is locked", () => {
  test("no route answers with them without a proof; with a proof they appear for the admin and the marked adult only", async () => {
    const { owner, adult, other, teen, child, row } = await household();
    const admin = row("Sage");
    const style = secretLora(admin.id, { availability: { who: "people", people: [row("Marlow").id] } });
    const clean = async (res: Response) => { const text = await textOf(res); for (const s of SECRET_STRINGS) expect(text).not.toContain(s); expect(text).not.toContain(style.id); return text; };
    const sweep = async (client: { get: (p: string, h?: Record<string, string>) => Promise<Response>; post: (p: string, b?: unknown, h?: Record<string, string>) => Promise<Response>; request: (p: string, i?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response> }) => {
      for (const path of ["/api/loras", "/api/loras?removed=true", "/api/loras/available", "/api/videos/settings", "/api/videos/status"]) await clean(await client.get(path));
      for (const [method, path] of [["PATCH", `/api/loras/${style.id}`], ["POST", `/api/loras/${style.id}/nsfw`], ["POST", `/api/loras/${style.id}/remove`], ["POST", `/api/loras/${style.id}/restore`], ["POST", `/api/loras/${style.id}/confirm`], ["PATCH", `/api/videos/adapters/${style.id}`], ["DELETE", `/api/videos/adapters/${style.id}`]] as const) {
        const res = await client.request(path, { method, body: method === "PATCH" ? { name: "x" } : {} });
        await clean(res);
        expect([403, 404]).toContain(res.status);
      }
    };
    await sweep(owner);
    await sweep(adult.client);
    for (const who of [other.client, teen.client, child.client]) await sweep(who);
    // The locked tile is the only trace: one flag, no count.
    expect(await (await owner.get("/api/loras/available")).json()).toEqual({ items: [], locked: true });
    expect(await (await other.client.get("/api/loras/available")).json()).toEqual({ items: [], locked: false });
    // Unlocked: the admin and the marked adult read it; the unmarked adult, the teen and the child still get nothing.
    const adminProof = await unlock(owner, "correcthorse");
    const marked = (await (await owner.get("/api/loras", unlockHeader(adminProof))).json()) as { items: Array<{ name: string }>; locked: boolean };
    expect(marked.items.map((i) => i.name)).toEqual([SECRET_STRINGS[0]]);
    expect(marked.locked).toBe(false);
    const adultProof = await unlock(adult.client);
    expect(((await (await adult.client.get("/api/loras/available", unlockHeader(adultProof))).json()) as { items: unknown[] }).items).toHaveLength(1);
    for (const who of [other.client, teen.client, child.client]) await clean(await who.get("/api/loras/available", unlockHeader(adminProof)));
  });
});

describe("a clip made with a style", () => {
  test("an adult-only style marks the job adult-only and locked before the Stack is called; an all-ages one does not", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const plain = putLora(admin.id);
    const adult = secretLora(admin.id, { base_model: "wan2.2-ti2v-5b" });
    fake.loras = [
      { id: plain.id, name: plain.name, sha256: plain.file.sha256, bytes: 1000, base_model: "wan2.2-ti2v-5b", licence: "MIT", source_url: null, classification: "all-ages", trigger_words: [], strength_default: 1, added_at: "2026-11-02T00:00:00Z" },
      { id: adult.id, name: adult.name, sha256: adult.file.sha256, bytes: 1000, base_model: "wan2.2-ti2v-5b", licence: "MIT", source_url: null, classification: "adult-only", trigger_words: [], strength_default: 1, added_at: "2026-11-02T00:00:00Z" },
    ];
    const start = (loras: string[]) => startVideoJob({ actor: admin, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", audience: "adult", loras: loras.map((id) => ({ id, strength: 1 })), seed: 1 } as never });
    const a = await start([plain.id]);
    expect((a.request as { adultOnly?: boolean }).adultOnly).toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(await usesAdultOnlyStyle([plain.id])).toBe(false);
    expect(await usesAdultOnlyStyle([plain.id, adult.id])).toBe(true);
    expect(await usesAdultOnlyStyle(["lora-nothere00000"])).toBe(true);
  });

  test("LoRAs reach the Stack on LTX-2.5 only when it reports support; otherwise the clip fails now with a plain line and nothing is queued", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const style = putLora(admin.id, { base_model: "ltx-2.5", compatible_with: ["ltx-2.5"] });
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
    expect(await wireLoras([{ id: style.id, strength: 5 }], LTX25_MODEL)).toEqual({ ok: false, line: LORAS_UNSUPPORTED_LINE });
    await expect(startVideoJob({ actor: admin, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "p", body: { prompt: "p", audience: "adult", model: LTX25_MODEL, loras: [{ id: style.id, strength: 1 }] } as never })).rejects.toMatchObject({ code: "loras_unsupported" });
    const status = readyVideoStatusForTests({ ltx25: "ready" });
    status.qualities!.ltx25!.loras = { supported: true, max: 2, mode: "unfused", negative_prompt: "none" };
    __setVideoStatusForTests(status);
    // Supported: the file's identity rides along and the strength is held inside the record's own range.
    expect(await wireLoras([{ id: style.id, strength: 5 }], LTX25_MODEL)).toEqual({ ok: true, loras: [{ id: style.id, strength: 1.5, sha256: style.file.sha256 }] });
    // Quick and Detailed send what they always did, with no engine report needed.
    expect(await wireLoras([{ id: style.id, strength: 1 }], undefined)).toEqual({ ok: true, loras: [{ id: style.id, strength: 1 }] });
    expect(await wireLoras(undefined, LTX25_MODEL)).toEqual({ ok: true, loras: undefined });
  });
});
