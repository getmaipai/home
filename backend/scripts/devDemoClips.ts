import { and, eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { db } from "@/db";
import { attachments, people, videoJobs } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { recordCreation } from "@/lib/creations/store";
import { newCreationId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

const fixtureIds = ["demo-sage-clip-1", "demo-sage-clip-2", "demo-sage-clip-3", "demo-sage-clip-4", "demo-marlow-clip-1"];

async function render(ffmpeg: string, dir: string, label: string): Promise<{ mp4: Uint8Array; jpg: Uint8Array }> {
  const mp4Path = join(dir, `${label}.mp4`), jpgPath = join(dir, `${label}.jpg`);
  const result = Bun.spawnSync([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x143d59:s=640x360:r=24", "-vf", "hue=h=45*t:s=1,drawbox=x='mod(t*180,640)':y=0:w=180:h=360:color=0xffb703@0.4:t=fill", "-t", "3", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", mp4Path]);
  if (result.exitCode !== 0) throw new Error(`ffmpeg could not render demo clip: ${result.stderr.toString()}`);
  const poster = Bun.spawnSync([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", mp4Path, "-frames:v", "1", "-q:v", "2", "-y", jpgPath]);
  if (poster.exitCode !== 0) throw new Error(`ffmpeg could not render demo poster: ${poster.stderr.toString()}`);
  return { mp4: new Uint8Array(await Bun.file(mp4Path).arrayBuffer()), jpg: new Uint8Array(await Bun.file(jpgPath).arrayBuffer()) };
}

function save(actor: PersonRow, bytes: Uint8Array, mediaType: string, provenance: string, name: string) {
  const result = storeFile(actor, { conversationId: null, turnId: null, retention: "kept", mediaType, bytes, provenance, deduplicate: false, name });
  if (!result.ok) throw new Error(`could not store demo media (${result.status})`);
  return result.value.id;
}

/** Creates the dev-only, real-file fixtures; safe to call repeatedly. */
export async function seedDemoClips(sageId: string, marlowId: string, ffmpeg = process.env.FFMPEG ?? "ffmpeg"): Promise<void> {
  const sage = db.select().from(people).where(eq(people.id, sageId)).get() as PersonRow | undefined;
  const marlow = db.select().from(people).where(eq(people.id, marlowId)).get() as PersonRow | undefined;
  if (!sage || !marlow) throw new Error("demo clip owners are missing");
  const work = mkdtempSync(join(tmpdir(), "maipai-demo-clips-"));
  try {
    const assets = await render(ffmpeg, work, "gradient");
    const specs = [
      { id: fixtureIds[0]!, owner: sage, prompt: "A warm blue gradient drifts across the screen", seed: 301, checks: null },
      { id: fixtureIds[1]!, owner: sage, prompt: "Golden light sweeps over a blue field", seed: 302, checks: { clip: { findings: ["soft"] } } },
      { id: fixtureIds[2]!, owner: sage, prompt: "A calm moving gradient, first take", seed: 303, checks: null },
      { id: fixtureIds[3]!, owner: sage, prompt: "A calm moving gradient, another take", seed: 304, checks: null },
      { id: fixtureIds[4]!, owner: marlow, prompt: "A quiet teal gradient with moving light", seed: 401, checks: null },
    ];
    const creationByJob = new Map<string, string>();
    for (const spec of specs) {
      const existing = db.select({ id: videoJobs.id }).from(videoJobs).where(eq(videoJobs.id, spec.id)).get();
      if (existing) continue;
      const clipId = save(spec.owner, assets.mp4, "video/mp4", `video-gen:{"v":1,"made_audience":"all-ages","lock":"off","job":"${spec.id}"}`, "Demo clip.mp4");
      const posterId = save(spec.owner, assets.jpg, "image/jpeg", `video-poster:{"v":1,"made_audience":"all-ages","lock":"off","job":"${spec.id}"}`, "Demo clip poster.jpg");
      const madeAt = new Date(Date.now() + specs.indexOf(spec) * 1000).toISOString();
      const file = { id: clipId, poster_id: posterId, width: 640, height: 360, seconds: 3, seed: spec.seed, model: "ltx25-q8", ms: 0, bytes: assets.mp4.byteLength, quality: "quick" as const, audio: false };
      const request = { size: "640x360", seconds: 3, seed: spec.seed, loras: [], source_file_id: null, end_file_id: null, tier: "standard", quality: "quick", audience: "adult", adultOnly: false, adultLock: "off", create: { recipe: "none" } };
      db.insert(videoJobs).values({ id: spec.id, personId: spec.owner.id, conversationId: null, turnId: null, companionId: null, kind: "generate", state: "done", stackJob: null, percent: 100, phase: "ready", position: null, prompt: spec.prompt, request: JSON.stringify(request), error: null, files: JSON.stringify([file]), createdAt: madeAt, updatedAt: madeAt, hlc: nextHlc() }).run();
      const creationId = newCreationId();
      const parentId = spec.id === fixtureIds[3] ? creationByJob.get(fixtureIds[2]!) : undefined;
      const creation = recordCreation(spec.owner, { id: creationId, kind: "video", fileIds: [clipId, posterId], jobIds: [spec.id], recipe: { tool: "video-create", route: "text" }, words: { written: spec.prompt, composed: spec.prompt }, generation: { kind: "video", job_id: spec.id, task: "generate", model: { id: "ltx25-q8", revision: "unknown", licence: "unknown" }, engine: { id: "unknown", version: "unknown" }, seed: spec.seed, duration_s: 3, bpm: null, key: null, parent_file_id: null, source_kind: "none", commercial_use: "unknown", commercial_basis: "Demo fixture.", made_at: madeAt, tier: "standard" }, settings: { width: 640, height: 360, seconds: 3, styles: [] }, checks: spec.checks, ...(parentId ? { parentId } : {}) });
      if (!creation) throw new Error(`could not write demo creation ${spec.id}`);
      creationByJob.set(spec.id, creation.id);
    }
    if (!db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.ownerPersonId, sage.id), eq(attachments.name, "Demo picture 1.jpg"))).get()) {
      for (const index of [1, 2]) save(sage, assets.jpg, "image/jpeg", "composer:upload", `Demo picture ${index}.jpg`);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (name: string) => args[args.indexOf(name) + 1];
  const dataDir = value("--data-dir"); const sageId = value("--sage"); const marlowId = value("--marlow");
  const live = resolve(process.env.MAIPAI_LIVE_INSTALL_ROOT ?? "/usr/local/maipai-home");
  if (!dataDir || resolve(dataDir) === live || resolve(dataDir).startsWith(`${live}/`)) throw new Error("Dev clips refuse to use the live install data directory");
  if (!sageId || !marlowId) throw new Error("Pass --sage and --marlow ids.");
  await seedDemoClips(sageId, marlowId);
}
