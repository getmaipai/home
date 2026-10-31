import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { dataDir } from "@/lib/paths";
import { readLook, versionPath } from "@/lib/companionLook";
import { getHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";

const portraitRoot = () => join(process.env.MAIPAI_DATA_DIR || dataDir, "companion-portraits");
const safePart = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);

export function portraitPath(companionId: string, versionId: string): string | null {
  if (!safePart(companionId) || !/^v-[0-9]+$/.test(versionId)) return null;
  return join(portraitRoot(), companionId, `${versionId}.webp`);
}


export function readRetainedPortrait(companionId: string, versionId: string): Uint8Array | null {
  const path = portraitPath(companionId, versionId);
  if (!path) return null;
  try { return new Uint8Array(readFileSync(path)); } catch { return null; }
}

/** Make the immutable, small chat portrait once. All snapshot failures are deliberately non-fatal. */
export async function retainCompanionPortrait(companionId: string, versionId: string): Promise<string | null> {
  try {
    const destination = portraitPath(companionId, versionId);
    if (!destination) return null;
    if (existsSync(destination)) return `${companionId}/${versionId}`;
    const source = versionPath(companionId, versionId);
    if (!source || !readLook(companionId).versions.some((version) => version.id === versionId)) return null;
    const metadata = await sharp(readFileSync(source), { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    const sourceBytes = readFileSync(source);
    const shortSide = Math.min(metadata.width ?? 192, metadata.height ?? 192);
    const bytes = await sharp(sourceBytes, { failOn: "error", limitInputPixels: 40_000_000 })
      .resize({ width: Math.round((metadata.width ?? 192) * 192 / shortSide), height: Math.round((metadata.height ?? 192) * 192 / shortSide), fit: "inside" })
      .webp({ quality: 78 }).toBuffer();
    mkdirSync(join(portraitRoot(), companionId), { recursive: true });
    // wx makes concurrent turn starts idempotent too.
    try { writeFileSync(destination, bytes, { flag: "wx" }); } catch (error) { if (!existsSync(destination)) throw error; }
    return `${companionId}/${versionId}`;
  } catch { return null; }
}

export function voiceVersion(voiceId: string | null | undefined): string | null {
  return typeof voiceId === "string" && voiceId.length > 0 ? createHash("sha256").update(voiceId).digest("hex").slice(0, 12) : null;
}

export function companionVoiceVersion(companionId: string): string | null {
  try {
    const voiceId = getHouseholdCompanion(companionId)?.companion?.voice_id;
    if (voiceId) return voiceVersion(voiceId);
    const loaded = loadManifestOnly(companionId);
    return loaded.ok ? voiceVersion(loaded.value.companion?.voice_id) : null;
  } catch { return null; }
}
