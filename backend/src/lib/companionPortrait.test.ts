import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { addVersion, deleteLook, deleteVersion, readLook, setRest } from "@/lib/companionLook";
import { companionVoiceVersion, portraitPath, readRetainedPortrait, retainCompanionPortrait, voiceVersion } from "@/lib/companionPortrait";
import { createHouseholdCompanion, deleteHouseholdCompanion, getHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";

const dataRoot = process.env.MAIPAI_DATA_DIR!;
const retainedRoot = join(dataRoot, "companion-portraits");
let companionId = "";
let versionId = "";
beforeEach(async () => { rmSync(retainedRoot, { recursive: true, force: true }); const loaded = loadManifestOnly("rivet"); if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable"); const created = createHouseholdCompanion({ ...loaded.value.companion, display_name: "Portrait fixture" }, { display_name: "Fixture author", person_id: "portrait-test" }); if (!created.ok) throw new Error(created.error); companionId = created.value.id; const png = new Uint8Array(await sharp({ create: { width: 480, height: 320, channels: 3, background: "#b24a31" } }).png().toBuffer()); const version = addVersion(companionId, png, { source: "upload", label: "Fixture", width: 480, height: 320, from: null }); versionId = version.id; setRest(companionId, versionId); });
afterEach(() => { if (companionId) deleteHouseholdCompanion(companionId); rmSync(retainedRoot, { recursive: true, force: true }); });

describe("retained companion portrait", () => {
  test("creates one 192 pixel WebP and leaves it after deleting its source and companion", async () => {
    const key = await retainCompanionPortrait(companionId, versionId); expect(key).toBe(`${companionId}/${versionId}`);
    const path = portraitPath(companionId, versionId)!; const before = readFileSync(path); const time = (await import("node:fs")).statSync(path).mtimeMs;
    expect(await retainCompanionPortrait(companionId, versionId)).toBe(key); expect((await import("node:fs")).statSync(path).mtimeMs).toBe(time); expect(Buffer.from(readFileSync(path))).toEqual(Buffer.from(before));
    const metadata = await sharp(before).metadata(); expect(metadata.format).toBe("webp"); expect(Math.min(metadata.width!, metadata.height!)).toBe(192);
    deleteLook(companionId); deleteHouseholdCompanion(companionId); expect(existsSync(path)).toBe(true); expect(readRetainedPortrait(companionId, versionId)).not.toBeNull();
  });
  test("returns null for an unreadable source without throwing", async () => { const { versionPath } = await import("@/lib/companionLook"); const source = versionPath(companionId, versionId)!; (await import("node:fs")).writeFileSync(source, "not an image"); expect(await retainCompanionPortrait(companionId, versionId)).toBeNull(); });
  test("hashes a voice id stably and returns null when missing", () => { expect(voiceVersion("voice-fixture")).toBe(voiceVersion("voice-fixture")); expect(voiceVersion(null)).toBeNull(); expect(voiceVersion("")).toBeNull(); expect(companionVoiceVersion(companionId)).toBe(getHouseholdCompanion(companionId)?.companion?.voice_id ? voiceVersion(getHouseholdCompanion(companionId)!.companion!.voice_id) : null); });
});
