// MUSIC-ID-01: library fingerprints: the background pass, the stored form and the privacy surfaces.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, musicFingerprints } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import { scanRoot } from "@/lib/media/scan";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetFingerprintMemoForTests, libraryFingerprintCount, loadLibraryFingerprints, runFingerprintPass } from "@/lib/music/fingerprintStore";
import { identifySong } from "@/lib/music/identify";
import { MUSIC_SETTINGS_KEYS } from "@/settings/musicKeys";
import { platformConnections } from "@/lib/privacy";

beforeEach(() => { resetDb(); __resetFingerprintMemoForTests(); });

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
