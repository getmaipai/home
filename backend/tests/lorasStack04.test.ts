// STACK-LORAS-01 slice 4 (docs/plans/stack-owns-loras-2026-11-25.md): Home reads the Stack's library and keeps no copy. Proves: the Styles tab routes
// (`/api/loras/stack/*`) show an adult-only style only as one locked tile with the Adult lock open, and send a teen, a child, or an adult with the lock
// closed no adult-only name, id or count; a Stack that cannot be read shows nothing and every style counts as adult-only; a `drive_missing` style is
// unavailable; the named adults of a style live in Home's small table; the ticket the Stack uses up through Home is single use and bound to one style.
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { loraPeople } from "@/db/schema";
import { __resetAdultLockForTests, consumeTicket, issueTicket, peekTicket } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { getLoraRecord, listLoraRecords, refreshLoras, loraLibraryReadable } from "@/lib/loras/stackLibrary";
import { loraUsable, readLoras } from "@/lib/loras/access";
import { usesAdultOnlyStyle } from "@/lib/videos/adultStyle";
import { patchLoraOnStack } from "@/lib/loras/stackAdmin";
import { app } from "@/app";
import { household, unlock, unlockHeader } from "./fixtures/adultLock";
import { putLora, secretLora, SECRET_STRINGS } from "./fixtures/lora";
import { fakeLoraStack } from "./helpers/fakeLoraStack";

setDefaultTimeout(30_000);
beforeEach(() => { resetDb(); __resetAdultLockForTests(); __resetThrottleForTests(); });

const textOf = async (res: Response): Promise<string> => res.text();
const STYLES = "/api/loras/stack";

describe("the Styles tab routes redact for who is looking", () => {
  test("a teen, a child and an adult with the lock closed get no adult-only name, id, count or preview from any Styles route", async () => {
    const { owner, adult, teen, child, row } = await household();
    const sage = row("Sage");
    const open = putLora(sage.id, { name: "Clay animation" });
    const secret = secretLora(sage.id);
    for (const [who, client, expectDenied] of [["teen", teen.client, true], ["child", child.client, true], ["adult", adult.client, true], ["owner locked", owner, false]] as const) {
      const res = await client.get(STYLES);
      const text = await textOf(res);
      for (const s of [...SECRET_STRINGS, secret.id]) expect(text, `${who} ${s}`).not.toContain(s);
      if (expectDenied) expect(res.status, who).toBe(403);
      else {
        expect(res.status).toBe(200);
        const body = JSON.parse(text) as { loras: Array<Record<string, unknown>> };
        expect(body.loras.map((l) => l.id ?? "locked")).toEqual([open.id, "locked"]);
        expect(body.loras.at(-1)).toEqual({ locked: true });
        expect(Object.keys(body.loras.at(-1)!)).toEqual(["locked"]);
      }
      for (const path of [`${STYLES}/${secret.id}/preview`, `${STYLES}/sources/civitai/search?q=x`]) {
        const t = await textOf(await client.get(path));
        for (const s of [...SECRET_STRINGS, secret.id]) expect(t, `${who} ${path}`).not.toContain(s);
      }
      const patched = await client.request(`${STYLES}/${secret.id}`, { method: "PATCH", body: { name: "x" } });
      expect([401, 403, 404]).toContain(patched.status);
      const patchedText = await textOf(patched);
      for (const s of [...SECRET_STRINGS, secret.id]) expect(patchedText, `${who} patch`).not.toContain(s);
    }
    expect(fakeLoraStack().patches.size).toBe(0); // nothing reached the Stack
  });

  test("with the Adult lock open the owner sees the style by name, and shuts it again to one tile", async () => {
    const { owner, row } = await household();
    const secret = secretLora(row("Sage").id);
    const proof = unlockHeader(await unlock(owner, "correcthorse"));
    const opened = (await (await owner.get(STYLES, proof)).json()) as { loras: Array<{ id?: string; name?: string; home?: unknown }> };
    expect(opened.loras.map((l) => l.id)).toEqual([secret.id]);
    expect(opened.loras[0]!.home).toBeUndefined(); // the record Home sent on import is not passed on
    const closed = (await (await owner.get(STYLES)).json()) as { loras: unknown[] };
    expect(closed.loras).toEqual([{ locked: true }]);
  });

  test("the Stack's own trash list is the admin's alone and still redacted", async () => {
    const { owner, adult, row } = await household();
    const gone = secretLora(row("Sage").id, { removed_at: "2026-11-20T00:00:00.000Z", trash_until: "2026-12-20T00:00:00.000Z" });
    expect((await adult.client.get(`${STYLES}?removed=true`)).status).toBe(403);
    const t = await textOf(await owner.get(`${STYLES}?removed=true`));
    for (const s of [...SECRET_STRINGS, gone.id]) expect(t).not.toContain(s);
  });
});

describe("a Stack that cannot be read", () => {
  test("shows no style, uses none, and counts every id as adult-only (fail closed)", async () => {
    const { owner, row } = await household();
    const sage = row("Sage");
    const plain = putLora(sage.id, { name: "Clay animation" });
    secretLora(sage.id);
    expect(await refreshLoras(true)).toBe(true);
    expect(readLoras(sage, "own_written", { media: "video" }).items.map((l) => l.id)).toEqual([plain.id]);
    expect(await usesAdultOnlyStyle([plain.id])).toBe(false);
    fakeLoraStack().down = true;
    expect(await refreshLoras(true)).toBe(false);
    expect(loraLibraryReadable()).toBe(false);
    expect(listLoraRecords()).toEqual([]);
    expect(getLoraRecord(plain.id)).toBeNull();
    expect(readLoras(sage, "own_written", { media: "video" })).toEqual({ items: [], locked: false });
    expect(await usesAdultOnlyStyle([plain.id])).toBe(true); // an id Home cannot resolve is adult-only
    const proof = unlockHeader(await unlock(owner, "correcthorse"));
    const res = await owner.get(STYLES, proof);
    expect(res.status).toBe(503);
    const text = await textOf(res);
    for (const s of SECRET_STRINGS) expect(text).not.toContain(s);
    expect((await owner.get("/api/loras", proof).then((r) => r.json()) as { items: unknown[]; locked: boolean })).toEqual({ items: [], locked: false });
  });

  test("a snapshot that has gone stale reads as empty until the library is read again", async () => {
    const { row } = await household();
    const sage = row("Sage");
    const plain = putLora(sage.id);
    expect(getLoraRecord(plain.id)).not.toBeNull();
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 60_000;
      expect(getLoraRecord(plain.id)).toBeNull();
      expect(loraLibraryReadable()).toBe(false);
    } finally { Date.now = realNow; }
    expect(await refreshLoras(true)).toBe(true);
    expect(getLoraRecord(plain.id)).not.toBeNull();
  });

});

describe("a style whose drive is not connected", () => {
  test("is unavailable: not usable, not offered", async () => {
    const { adult, row } = await household();
    const sage = row("Sage");
    const gone = putLora(sage.id, { name: "On a drive", status: "drive_missing", disk_id: "usb-1", availability: { who: "adults", people: [] } });
    const fine = putLora(sage.id, { name: "On this computer", availability: { who: "adults", people: [] } });
    expect(loraUsable(getLoraRecord(gone.id)!)).toBe(false);
    expect(loraUsable(getLoraRecord(fine.id)!)).toBe(true);
    const offered = (await (await adult.client.get("/api/loras/available?media=video")).json()) as { items: Array<{ id: string; usable: boolean }> };
    expect(offered.items.filter((i) => i.usable).map((i) => i.id)).toEqual([fine.id]);
  });
});

describe("the named adults of a style", () => {
  test("live in Home's small table, never in the library; a minor is refused", async () => {
    const { adult, other, teen, row } = await household();
    const owner = row("Sage");
    const style = putLora(owner.id, { availability: { who: "admins", people: [] } });
    const sage = owner;
    const marlow = row("Marlow");
    const saved = await patchLoraOnStack(sage, style.id, { availability: { who: "people", people: [marlow.id] } });
    expect(saved.availability).toEqual({ who: "people", people: [marlow.id] });
    expect(fakeLoraStack().patches.get(style.id)).toEqual({ availability_who: "people" }); // the Stack gets the word, not the names
    expect(db.select().from(loraPeople).where(eq(loraPeople.loraId, style.id)).get()?.people).toBe(JSON.stringify([marlow.id]));
    expect(JSON.stringify(fakeLoraStack().views.get(style.id))).not.toContain(marlow.id);
    await refreshLoras(true);
    expect((await (await adult.client.get("/api/loras/available?media=video")).json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([style.id]);
    expect((await (await other.client.get("/api/loras/available?media=video")).json() as { items: unknown[] }).items).toEqual([]);
    await expect(patchLoraOnStack(sage, style.id, { availability: { who: "people", people: [row("Nova").id] } })).rejects.toMatchObject({ code: "minor_in_people", message: "Only adults can be chosen. Pick adults, or choose all adults." });
    expect((await (await teen.client.get("/api/loras/available?media=video")).json() as { items: unknown[] }).items).toEqual([]);
  });
});

describe("lowering the Stack's nsfw tag from Home", () => {
  test("Home checks its own ticket, then calls the Stack with no ticket; the ticket is used up only after the Stack accepts", async () => {
    const { owner, row } = await household();
    const style = secretLora(row("Sage").id);
    const proof = unlockHeader(await unlock(owner, "correcthorse"));
    const res = await owner.request(`${STYLES}/${style.id}`, { method: "PATCH", body: { classification: "all-ages", ticket: "home" }, headers: proof });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { classification: string }).classification).toBe("all-ages");
    const sent = fakeLoraStack().patches.get(style.id)!;
    expect(sent.classification).toBe("all-ages");
    expect(sent.ticket).toBeUndefined(); // the Stack knows no tickets
    // Raising needs no ticket either.
    const back = await owner.request(`${STYLES}/${style.id}`, { method: "PATCH", body: { classification: "adult-only" }, headers: proof });
    expect(back.status).toBe(200);
    expect(fakeLoraStack().patches.get(style.id)!.ticket).toBeUndefined();
  });

  test("a ticket for another style or a spent one never reaches the Stack as a lowering when the source said adult", async () => {
    const { row } = await household();
    const sage = row("Sage");
    const a = issueTicket(sage.id, "session-key", "lora-aaaaaaaaaaaa").ticket;
    expect(peekTicket(a, sage.id, "session-key", "lora-bbbbbbbbbbbb")).toBe(false);
    expect(peekTicket(a, sage.id, "session-key", "lora-aaaaaaaaaaaa")).toBe(true);
    expect(consumeTicket(a, sage.id, "session-key", "lora-aaaaaaaaaaaa")).toBe(true);
    expect(consumeTicket(a, sage.id, "session-key", "lora-aaaaaaaaaaaa")).toBe(false);
  });

  test("a style the download site tagged nsfw (origin site) is lowered through Home only with a live ticket", async () => {
    const { owner, row } = await household();
    const style = secretLora(row("Sage").id);
    fakeLoraStack().views.get(style.id)!.classification_origin = "site";
    await refreshLoras(true);
    const proof = unlockHeader(await unlock(owner, "correcthorse"));
    const refused = await owner.request(`${STYLES}/${style.id}`, { method: "PATCH", body: { classification: "all-ages" }, headers: proof });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { code: string }).code).toBe("ticket_required");
    expect(fakeLoraStack().views.get(style.id)!.classification).toBe("adult-only");
    const ticket = ((await (await owner.post("/api/adult-lock/confirm", { secret: "correcthorse", action: "unmark", item: style.id })).json()) as { ticket: string }).ticket;
    const done = await owner.request(`${STYLES}/${style.id}`, { method: "PATCH", body: { classification: "all-ages", ticket }, headers: proof });
    expect(done.status).toBe(200);
    expect(fakeLoraStack().views.get(style.id)!.classification).toBe("all-ages");
  });

  test("the old callback route is gone", async () => {
    const res = await app.request("/api/stack/adult-ticket/consume", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: "x", item: "y" }) });
    expect(res.status).toBe(404);
  });
});

describe("installing as All ages needs the open Adult lock", () => {
  const body = { media: "picture", source: "civitai", url: "https://civitai.com/models/1", name: "Paper boat", audience: "all-ages" };
  test("a signed-in admin with the lock closed is refused before anything reaches the Stack; with it open the request goes through", async () => {
    const { owner } = await household();
    const closed = await owner.request(`${STYLES}/install`, { method: "POST", body });
    expect(closed.status).toBe(403);
    expect(((await closed.json()) as { code: string }).code).toBe("unlock_needed");
    const proof = unlockHeader(await unlock(owner, "correcthorse"));
    const open = await owner.request(`${STYLES}/install`, { method: "POST", body, headers: proof });
    expect(open.status).not.toBe(403);
  });
});

describe("STACK-LORAS-01: the admin sees every record the Stack lists (the engine part included)", () => {
  const INGREDIENTS = "ltx-2.5-22b-ic-lora-ingredients-0.9";

  test("the Styles page lists the video-from-pictures adapter for an admin, with the Stack's status, and no picker, tool or suggestion offers it", async () => {
    const { owner, adult, teen, child, row } = await household();
    const sage = row("Sage");
    const style = putLora(sage.id, { name: "Clay animation", base_model: "ltx-2.5", compatible_with: ["ltx-2.5"] });
    const adapter = putLora(sage.id, {
      name: INGREDIENTS, base_model: "ltx-2.5", compatible_with: ["ltx-2.5"], file: { sha256: "ff".repeat(32), bytes: 1_308_787_472, rank: 128, modules: [], format: "safetensors" },
      source: { site: "huggingface", url: "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Ingredients", remote_id: null, version_id: null, token_ref: null },
    });
    // The admin's page lists exactly what the Stack lists, same status.
    const body = (await (await owner.get(STYLES)).json()) as { loras: Array<{ id?: string; name?: string; media?: string; base_model?: string; bytes?: number; status?: string; classification?: string }> };
    expect(body.loras.map((l) => l.id)).toEqual([style.id, adapter.id]);
    expect(body.loras.find((l) => l.id === adapter.id)).toMatchObject({ name: INGREDIENTS, media: "video", base_model: "ltx-2.5", bytes: 1_308_787_472, status: "ready", classification: "all-ages" });
    // Its admin actions resolve (a 404 here would mean the page lists a style it cannot act on).
    expect((await owner.request(`${STYLES}/${adapter.id}`, { method: "PATCH", body: { strength_default: 0.8 } })).status).toBe(200);
    // Everything that is not the admin's library keeps leaving it out: the picker, the chat tool's names, suggestions, the available list.
    await refreshLoras(true);
    expect(getLoraRecord(adapter.id)).toBeNull();
    expect(listLoraRecords().map((l) => l.id)).toEqual([style.id]);
    expect(readLoras(row("Sage"), "own_written").items.map((l) => l.id)).toEqual([style.id]);
    // A non-admin of any age gets no name, id or hint of it.
    for (const client of [adult.client, teen.client, child.client]) {
      const res = await client.get(STYLES);
      expect(res.status).toBe(403);
      const text = await textOf(res);
      expect(text).not.toContain(INGREDIENTS);
      expect(text).not.toContain(adapter.id);
    }
  });
});
