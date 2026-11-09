// Shared setup for the talk tests: a household companion with a rest picture and a fake picture engine.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";
import { createHouseholdCompanion, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { addVersion, setRest, updateSheet } from "@/lib/companionLook";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";

export const MOUTH = { x: 0.35, y: 0.6, w: 0.3, h: 0.2 };
export const EYES = { x: 0.25, y: 0.3, w: 0.5, h: 0.1 };
export const SIZE = 1024;
export const AGE_OK = { ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } };
export const CHILD_OK = { ok: true as const, verdict: { is_cartoon: true, looks_like_photo: false, brand_or_licensed_character: false, violent_or_scary: false, sexual_or_romantic: false, weapons_drugs_or_alcohol: false, confidence: 1 } };
export const AGE_WITHHELD = { ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 8, label: "child" as const, is_nude_or_sexual: true, confidence: 1 } };

const now = new Date().toISOString();

export function addPerson(id: string, role: string): string {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `session-${id}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.insert(sessions).values({ id: `sess-${id}`, personId: id, tokenHash, expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}

export function personRow(id: string): PersonRow {
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

/** An opaque picture with a diagonal gradient, so any pasted pixel is easy to tell from the rest. */
export async function restPicture(): Promise<Uint8Array> {
  const raw = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const at = (y * SIZE + x) * 3;
      raw[at] = (x / 4) % 256;
      raw[at + 1] = (y / 4) % 256;
      raw[at + 2] = ((x + y) / 8) % 256;
    }
  }
  return new Uint8Array(await sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer());
}

export function fixtureCompanion() {
  const loaded = loadManifestOnly("rivet");
  if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
  return loaded.value.companion;
}

/** A household companion with an approved-style rest picture and a sheet that is not approved. */
export async function makeCompanion(personId: string, name: string, publish = false) {
  const made = createHouseholdCompanion({ ...fixtureCompanion(), display_name: name }, { display_name: "Author", person_id: personId });
  if (!made.ok) throw new Error(made.error);
  const id = made.value.id;
  const rest = addVersion(id, await restPicture(), { source: "upload", label: "rest", width: SIZE, height: SIZE, from: null });
  setRest(id, rest.id);
  updateSheet(id, {
    views: { left: null, right: null, mouth: null },
    card: { text: "fox", species: "fox", colours: ["#CC3322"] },
    key: "#00FF00",
    state: "needs_review",
    approved_by: null,
    approved_at: null,
  });
  if (publish) {
    setHouseholdCompanionAudience(id, "all", { display_name: "Admin" });
    setHouseholdCompanionStatus(id, "ready");
    __reloadPersonasForTests();
  }
  return { id, rest: rest.id };
}

export interface FakeStack {
  forms: FormData[];
}

/** A fake picture engine: returns the cropped input with a dark box painted in its middle (the "mouth"). */
export function installFakeStack(): FakeStack {
  const fake: FakeStack = { forms: [] };
  const results = new Map<string, Uint8Array>();
  __setPicturesFetchForTests((async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/images/edits") && init?.method === "POST") {
      const form = init.body as FormData;
      fake.forms.push(form);
      const source = new Uint8Array(await (form.get("image") as File).arrayBuffer());
      const meta = await sharp(source).metadata();
      const box = Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect x="${meta.width! / 2 - 60}" y="${meta.height! / 2 - 40}" width="120" height="80" fill="black"/></svg>`);
      const painted = await sharp(source).composite([{ input: box }]).png().toBuffer();
      const job = `talk-job-${fake.forms.length}`;
      results.set(job, new Uint8Array(painted));
      return Response.json({ job }, { status: 202 });
    }
    const job = /\/(talk-job-\d+)$/.exec(url);
    if (job) {
      const b64_json = Buffer.from(results.get(job[1]!)!).toString("base64");
      return Response.json({ job: job[1], state: "done", progress: 1, data: [{ b64_json }] });
    }
    return new Response("Not found", { status: 404 });
  }) as unknown as typeof fetch);
  return fake;
}

export async function waitForTalk(read: () => { state: string } | null): Promise<{ state: string; error?: string | null }> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const job = read();
    if (job && !["queued", "running"].includes(job.state)) return job as { state: string; error?: string | null };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The talk job did not finish.");
}
