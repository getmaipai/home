import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classDir } from "@/lib/paths";
import type { AgeBand } from "@/lib/ageBand";

export const answerImagesCacheDir = classDir("answer-images");
const INDEX = () => join(answerImagesCacheDir, "index.json");
const CACHE_CAP = 300 * 1024 * 1024;
let cacheCap = CACHE_CAP;
const MEMORY = new Map<string, CacheEntry>();
type CacheEntry = { band: AgeBand; tile: string; full: string; bytes: number; lastUsedAt: string; originalUrl?: string; leadImage?: boolean; evicted?: boolean; temporaryChatId?: string; memory?: { tile: Uint8Array; full: Uint8Array } };
type PutInput = { tile: Uint8Array; full: Uint8Array; band: AgeBand; temporary?: boolean; temporaryChatId?: string; originalUrl?: string; leadImage?: boolean };
type CacheIndex = Record<string, CacheEntry>;

function readIndex(): CacheIndex {
  try { return JSON.parse(readFileSync(INDEX(), "utf8")) as CacheIndex; } catch { return {}; }
}
function writeIndex(index: CacheIndex): void { mkdirSync(answerImagesCacheDir, { recursive: true }); writeFileSync(INDEX(), JSON.stringify(index)); }
function file(id: string, variant: "tile" | "full"): string { return join(answerImagesCacheDir, `${id}-${variant}.webp`); }

function sweep(index: CacheIndex): void {
  let total = Object.values(index).reduce((sum, e) => sum + (e.evicted ? 0 : e.bytes), 0);
  const oldest = Object.entries(index).sort((a, b) => a[1].lastUsedAt.localeCompare(b[1].lastUsedAt));
  for (const [id, entry] of oldest) {
    if (total <= cacheCap) break;
    for (const variant of ["tile", "full"] as const) if (existsSync(file(id, variant))) unlinkSync(file(id, variant));
    total -= entry.bytes;
    entry.evicted = true;
    entry.bytes = 0;
  }
  const evicted = Object.entries(index).filter(([, entry]) => entry.evicted).sort((a, b) => a[1].lastUsedAt.localeCompare(b[1].lastUsedAt));
  for (const [id] of evicted.slice(0, Math.max(0, evicted.length - 5_000))) delete index[id];
}

export async function putAnswerImage(input: PutInput): Promise<string> {
  if (input.temporary && !input.temporaryChatId) throw new Error("temporary answer pictures need a chat id");
  const digest = createHash("sha256").update(input.tile).update(input.full).digest("hex");
  const id = `ai_${digest.slice(0, 32)}`;
  const entry: CacheEntry = { band: input.band, tile: `${id}-tile.webp`, full: `${id}-full.webp`, bytes: input.tile.byteLength + input.full.byteLength, lastUsedAt: new Date().toISOString(), originalUrl: input.originalUrl, leadImage: input.leadImage };
  if (input.temporary) MEMORY.set(id, { ...entry, temporaryChatId: input.temporaryChatId, memory: { tile: new Uint8Array(input.tile), full: new Uint8Array(input.full) } });
  else {
    mkdirSync(answerImagesCacheDir, { recursive: true });
    writeFileSync(file(id, "tile"), input.tile); writeFileSync(file(id, "full"), input.full);
    const index = readIndex(); index[id] = entry; sweep(index); writeIndex(index);
  }
  return id;
}

export async function getAnswerImage(id: string, band: AgeBand, variant: "tile" | "full"): Promise<Uint8Array | null> {
  if (!/^ai_[a-f0-9]{32}$/.test(id)) return null;
  const memory = MEMORY.get(id);
  if (memory) return band === "adult" || memory.band === band ? new Uint8Array(memory.memory![variant]) : null;
  const index = readIndex();
  const entry = index[id];
  if (!entry || (band !== "adult" && entry.band !== band)) return null;
  const path = file(id, variant);
  if (!existsSync(path) && entry.originalUrl) {
    const { fetchAnswerImages } = await import("./fetch");
    const refetched = await fetchAnswerImages([{ id, url: entry.originalUrl, leadImage: entry.leadImage }]);
    const image = refetched.images.find(candidate => candidate.id === id);
    if (!image) return null;
    mkdirSync(answerImagesCacheDir, { recursive: true });
    writeFileSync(file(id, "tile"), image.tile); writeFileSync(file(id, "full"), image.full);
    entry.bytes = image.tile.byteLength + image.full.byteLength; entry.evicted = false; entry.lastUsedAt = new Date().toISOString();
    sweep(index); writeIndex(index);
    return new Uint8Array(variant === "tile" ? image.tile : image.full);
  }
  if (!existsSync(path)) { delete index[id]; writeIndex(index); return null; }
  entry.lastUsedAt = new Date().toISOString(); writeIndex(index);
  return new Uint8Array(readFileSync(path));
}

export function clearAnswerImageCacheForTests(): void {
  MEMORY.clear();
  // Deliberately only clear the process-local temporary cache. Persistent
  // files are under MAIPAI_DATA_DIR and test isolation removes that dir.
}

export function clearTemporaryAnswerImages(temporaryChatId?: string): void {
  if (!temporaryChatId) { MEMORY.clear(); return; }
  for (const [id, entry] of MEMORY) if (entry.temporaryChatId === temporaryChatId) MEMORY.delete(id);
}
export function __setAnswerImageCacheCapForTests(bytes: number): void { cacheCap = Math.max(1, bytes); }

export function sweepAnswerImages(now = new Date()): { expired: number; evicted: number } {
  const index = readIndex();
  let expired = 0;
  for (const [id, entry] of Object.entries(index)) {
    if (now.getTime() - new Date(entry.lastUsedAt).getTime() <= 30 * 86400_000) continue;
    for (const variant of ["tile", "full"] as const) if (existsSync(file(id, variant))) unlinkSync(file(id, variant));
    delete index[id]; expired++;
  }
  const before = Object.values(index).filter(entry => !entry.evicted).length; sweep(index); const evicted = before - Object.values(index).filter(entry => !entry.evicted).length; writeIndex(index);
  return { expired, evicted };
}
