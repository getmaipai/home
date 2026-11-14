// MUSIC-ID-01: library fingerprints: the background pass, the stored form and the privacy surfaces.
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources, musicFingerprints } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import { dirname, join } from "node:path";
import { scanRoot } from "@/lib/media/scan";
import { __resetSettingsCacheForTests, setHouseholdSettingValue } from "@/lib/settings";
import { __resetFingerprintMemoForTests, kickFingerprintPass, libraryFingerprintCount, libraryFingerprintProgress, loadLibraryFingerprints, runFingerprintPass } from "@/lib/music/fingerprintStore";
import { identifySong } from "@/lib/music/identify";
import { packRaw } from "@/lib/music/identifyAudio";
import { MUSIC_SETTINGS_KEYS } from "@/settings/musicKeys";
import { platformConnections } from "@/lib/privacy";

beforeEach(() => { resetDb(); __resetSettingsCacheForTests(); __resetFingerprintMemoForTests(); });

async function scanned(): Promise<string[]> {
  setHouseholdSettingValue("music.musicbrainz_match", false);
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const tree = buildMediaTree();
  const made = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  const id = ((await made.json()) as { source: { id: string } }).source.id;
  await scanRoot(id, { prober: null, pruneGraceMs: 0 });
  return db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all().map((row) => row.id);
}

describe("the fingerprint pass", () => {
  test("skipped when fpcalc is missing", async () => {
    await scanned();
    const out = await runFingerprintPass({ hasFpcalc: () => false });
    expect(out.skipped).toBe(true);
    expect(libraryFingerprintCount()).toBe(0);
  });
  test("one file at a time, stored once, an unreadable file marked and not retried", async () => {
    const ids = await scanned();
    expect(ids.length).toBeGreaterThan(1);
    let active = 0, peak = 0; const seen: string[] = [];
    const fingerprint = async (path: string) => { active++; peak = Math.max(peak, active); seen.push(path); await Bun.sleep(2); active--; return seen.length === 1 ? null : Uint32Array.from([seen.length, 7, 9]); };
    const first = await runFingerprintPass({ hasFpcalc: () => true, fingerprint });
    expect(peak).toBe(1);
    expect(first.considered).toBe(ids.length);
    expect(first.failed).toBe(1);
    expect(first.stored).toBe(ids.length - 1);
    expect(libraryFingerprintCount()).toBe(ids.length - 1);
    expect(db.select().from(musicFingerprints).all()).toHaveLength(ids.length);
    const again = await runFingerprintPass({ hasFpcalc: () => true, fingerprint });
    expect(again.considered).toBe(0);
    expect(loadLibraryFingerprints()).toHaveLength(ids.length - 1);
  });
  test("a changed file is fingerprinted again", async () => {
    const ids = await scanned();
    await runFingerprintPass({ hasFpcalc: () => true, fingerprint: async () => Uint32Array.from([1, 2, 3]) });
    db.update(mediaItems).set({ fingerprint: "changed-key" }).where(eq(mediaItems.id, ids[0]!)).run();
    const out = await runFingerprintPass({ hasFpcalc: () => true, fingerprint: async () => Uint32Array.from([4, 5, 6]) });
    expect(out.considered).toBe(1);
  });
  test("the pass drains past one 25 song batch and skips completed rows", async () => {
    await scanned();
    // Duplicate existing eligible items to exceed the per-pass budget while retaining the real scan setup.
    const original = db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all();
    const sourceId = original[0]!.sourceId;
    for (let i = 0; i < 30; i++) {
      const row = original[i % original.length]!;
      const root = db.select().from(mediaItems).where(eq(mediaItems.id, row.id)).get()!;
      const path = `${row.locPath}-extra-${i}`;
      const source = db.select().from(mediaSources).where(eq(mediaSources.id, row.sourceId!)).get()!;
      const full = join(source.rootPath!, path);
      mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, "audio");
      db.insert(mediaItems).values({ ...root, id: `extra-${i}`, title: `Extra ${i}`, locPath: path, fingerprint: `extra-key-${i}` }).run();
    }
    let calls = 0;
    const fingerprint = async () => { calls++; return Uint32Array.from([calls, 2, 3]); };
    const autoStart = process.env.MAIPAI_FINGERPRINT_NO_AUTOSTART;
    delete process.env.MAIPAI_FINGERPRINT_NO_AUTOSTART;
    const drained = await kickFingerprintPass({ hasFpcalc: () => true, fingerprint, budget: 25, pause: async () => {} });
    if (autoStart !== undefined) process.env.MAIPAI_FINGERPRINT_NO_AUTOSTART = autoStart;
    expect(drained.considered).toBe(7);
    expect(calls).toBe(32);
    expect((await runFingerprintPass({ hasFpcalc: () => true, fingerprint, budget: 25 })).considered).toBe(0);
    expect(sourceId).toBeTruthy();
  });
  test("songs made at home are never fingerprinted, counted or matched; an imported song is", async () => {
    await scanned();
    const base = db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all()[0]!;
    const source = db.select().from(mediaSources).where(eq(mediaSources.id, base.sourceId!)).get()!;
    const addFile = (name: string) => { const full = join(source.rootPath!, name); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, "audio"); return name; };
    const madePath = addFile("made-by-provenance.mp3");
    db.insert(mediaItems).values({ ...base, id: "made-1", title: "Made at home", locPath: madePath, fingerprint: "made-key-1", provenance: "music:generated-library" }).run();
    db.insert(mediaSources).values({ ...source, id: "msrc-madetest", rootPath: join(source.rootPath!, "made-at-home") }).run();
    const madeRoot = addFile("made-at-home/made-by-source.mp3");
    db.insert(mediaItems).values({ ...base, id: "made-2", title: "Made at home 2", sourceId: "msrc-madetest", locRootId: "msrc-madetest", locPath: "made-by-source.mp3", fingerprint: "made-key-2" }).run();
    expect(madeRoot).toBeTruthy();
    const importedPath = addFile("imported-song.mp3");
    db.insert(mediaItems).values({ ...base, id: "imported-1", title: "Imported", locPath: importedPath, fingerprint: "imported-key" }).run();
    const seen: string[] = [];
    await runFingerprintPass({ hasFpcalc: () => true, budget: 100, pause: async () => {}, fingerprint: async (path) => { seen.push(path); return Uint32Array.from([1, 2, 3]); } });
    expect(seen.some((path) => path.includes("made-by-provenance") || path.includes("made-by-source"))).toBe(false);
    expect(seen.some((path) => path.includes("imported-song"))).toBe(true);
    expect(db.select().from(musicFingerprints).where(eq(musicFingerprints.itemId, "made-1")).all()).toHaveLength(0);
    expect(db.select().from(musicFingerprints).where(eq(musicFingerprints.itemId, "made-2")).all()).toHaveLength(0);
    // The progress count leaves them out too: every eligible song is done after the pass.
    const progress = libraryFingerprintProgress();
    expect(progress.done).toBe(progress.total);
    // Even a stored fingerprint of a made song is never loaded for matching.
    db.insert(musicFingerprints).values({ itemId: "made-1", fingerprint: packRaw(Uint32Array.from([9, 9, 9])), fileKey: "made-key-1", createdAt: new Date().toISOString() }).run();
    __resetFingerprintMemoForTests();
    expect(loadLibraryFingerprints().some((row) => row.itemId === "made-1")).toBe(false);
    expect(loadLibraryFingerprints().some((row) => row.itemId === "imported-1")).toBe(true);
  });
  test("stops a pass when fpcalc disappears and reports progress", async () => {
    await scanned();
    let available = true;
    const out = await runFingerprintPass({ hasFpcalc: () => available, fingerprint: async () => { available = false; return Uint32Array.from([1, 2, 3]); }, budget: 1 });
    expect(out.considered).toBe(1);
    expect(libraryFingerprintProgress()).toMatchObject({ done: 1, total: expect.any(Number), running: false });
    expect(libraryFingerprintProgress().total).toBeGreaterThan(1);
    expect((await runFingerprintPass({ hasFpcalc: () => false })).skipped).toBe(true);
  });
  test("a clip is matched against the stored library fingerprints", async () => {
    const ids = await scanned();
    const target = Array.from({ length: 10 }, (_, i) => (0x9e3779b1 * (i + 1)) >>> 0);
    let n = 0;
    await runFingerprintPass({ hasFpcalc: () => true, fingerprint: async () => (n++ === 0 ? Uint32Array.from([0, ...target, 0]) : Uint32Array.from(Array.from({ length: 12 }, (_, i) => (0x85ebca6b * (n * 31 + i)) >>> 0))) });
    const out = await identifySong({ bytes: new Uint8Array(4), kind: { kind: "container" } }, {
      decode: async () => ({ pcm: new Uint8Array(100), seconds: 5 }), fingerprint: async () => ({ raw: Uint32Array.from(target), compressed: null, seconds: 5 }),
      mode: "off", key: null, hasFpcalc: true, log: () => {},
    });
    expect(out.status).toBe("matched");
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("privacy surfaces", () => {
  test("the music.identify.online mirror equals the pinned spec entry", () => {
    const spec = JSON.parse(readFileSync(join(import.meta.dir, "../node_modules/@maipai/spec/settings/keys.json"), "utf8")) as unknown;
    const list = (Array.isArray(spec) ? spec : (spec as { keys: unknown[] }).keys) as Array<Record<string, unknown>>;
    const fromSpec = list.find((k) => k.key === "music.identify.online")!;
    const mirror = MUSIC_SETTINGS_KEYS.find((k) => k.key === "music.identify.online")!;
    expect(JSON.parse(JSON.stringify(mirror))).toEqual(JSON.parse(JSON.stringify(fromSpec)));
  });
  test("the AcoustID row is listed only with a key and the setting not off", async () => {
    const ids = () => platformConnections().map((c) => c.id);
    expect(ids()).not.toContain("platform:music-identify");
    setHouseholdSettingValue("acoustid.client", "k-123");
    const row = platformConnections().find((c) => c.id === "platform:music-identify");
    expect(row?.destination).toBe("api.acoustid.org");
    expect(row?.what).toContain("never audio");
    setHouseholdSettingValue("music.identify.online", "off");
    expect(ids()).not.toContain("platform:music-identify");
  });
});
