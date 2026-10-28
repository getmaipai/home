// RADIO-05: recordings are Stack media.fetch jobs. Home submits only a guarded public address; it never carries station audio.
import { and, eq, isNull } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { db } from "@/db";
import { mediaItems, mediaSources, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newMediaItemId, newMediaSourceId } from "@/lib/id";
import { getStackClient } from "@/lib/stackEngine";
import { dataDir, ensureDataDir } from "@/lib/paths";
import { storeFile, attachmentFilePath } from "@/lib/attachments";
import { createHash } from "node:crypto";
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import type { PersonRow } from "@/types";
import { checkStorageCap } from "@/lib/storage/usage";
import { mediaBandOf } from "./band";
import { registerMediaAppData, registerItemView } from "./appHost";
import { readableItem } from "./access";
import type { SavedStation } from "./radio";
import { publicRecordingAddress } from "./radioStream";
import { radioAddressDeps } from "@/routes/radioApp";

const active = new Map<string, { personId: string; station: SavedStation; jobId: string; outputDir: string; timer: ReturnType<typeof setTimeout> | null }>();
const durations: Record<string, number | null> = { "15": 15, "30": 30, "60": 60, "120": 120, until_stopped: null };
const error = (status: 400 | 403 | 404 | 409 | 422 | 502, message: string) => ({ ok: false as const, status, error: message });

export type RecordingOutcome<T> = { ok: true; value: T } | ReturnType<typeof error>;

function sourceFor(owner: PersonRow): string {
  const id = newMediaSourceId();
  const now = new Date().toISOString();
  db.insert(mediaSources).values({ id, kind: "root", scope: "person", ownerPersonId: owner.id, label: "Radio recordings", rootPath: "radio-recordings", rootKinds: JSON.stringify(["track"]), paused: true, visibleTo: JSON.stringify([owner.id]), createdAt: now, hlc: nextHlc(), provenance: "radio:recording" }).run();
  return id;
}

export async function startRadioRecording(person: PersonRow, station: SavedStation, length: string): Promise<RecordingOutcome<{ job_id: string; station_id: string }>> {
  if (mediaBandOf(person) === "child" || person.role === "guest") return error(403, "Radio recording is available to teens and adults.");
  if (!(length in durations)) return error(400, "Choose 15, 30, 60 or 120 minutes, or until stopped.");
  if ([...active.values()].some((r) => r.personId === person.id)) return error(409, "You already have a radio recording in progress.");
  if (active.size >= 4) return error(409, "Four recordings are already in progress in this home. Stop one before starting another.");
  const cap = checkStorageCap(person.role, person.id, (durations[length] ?? 120) * 1_000_000);
  if (!cap.ok) return error(403, cap.error ?? "There is not enough room in the storage plan for this recording.");
  let url: string;
  try { url = await publicRecordingAddress(station, radioAddressDeps().dnsLookup); } catch { return error(422, "That station points to a private address. Recordings require a public HTTPS stream."); }
  const reservation = `starting:${person.id}`;
  active.set(reservation, { personId: person.id, station, jobId: reservation, outputDir: "", timer: null });
  try {
    const client = getStackClient();
    const outputDir = resolve(dataDir, "radio-recordings", person.id);
    ensureDataDir(outputDir);
    const current = await client.mediaRoots();
    if (!current.write.includes(outputDir)) await client.setMediaRoots({ read: current.read, write: [...current.write, outputDir] });
    const job: StackJob = await client.submitJob({ kind: "media.fetch", input: { url, kind: "audio", person_initiated: true, subtitles: false, quality: "best", max_items: 1, output_dir: outputDir } });
    const entry = { personId: person.id, station, jobId: job.id, outputDir, timer: null as ReturnType<typeof setTimeout> | null };
    if (durations[length] !== null) entry.timer = setTimeout(() => { void stopRadioRecording(person, station.id); }, durations[length]! * 60_000);
    active.delete(reservation);
    active.set(job.id, entry);
    return { ok: true, value: { job_id: job.id, station_id: station.id } };
  } catch { active.delete(reservation); return error(502, "The Stack could not start this recording. Try again later."); }
}

function jobResultFiles(result: unknown): Array<{ path: string; title?: string; duration_s?: number; media_type?: string; size_bytes?: number }> {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : [];
  return items.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    return typeof item.path === "string" ? [{ path: item.path, title: typeof item.title === "string" ? item.title : undefined, duration_s: typeof item.duration_s === "number" ? item.duration_s : undefined, media_type: typeof item.ext === "string" ? ({ mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/opus", wav: "audio/wav", flac: "audio/flac" } as Record<string, string>)[item.ext] : undefined, size_bytes: typeof item.size_bytes === "number" ? item.size_bytes : undefined }] : [];
  });
}

async function finish(entry: { personId: string; station: SavedStation; jobId: string; outputDir: string }, suppliedJob?: StackJob, keepPartial = false): Promise<void> {
  const owner = db.select().from(people).where(eq(people.id, entry.personId)).get() as PersonRow | undefined;
  if (!owner) return;
  let job: StackJob;
  try { job = suppliedJob ?? await getStackClient().job(entry.jobId); } catch { return; }
  if (["queued", "running", "paused", "stalled"].includes(job.state)) return;
  const current = active.get(entry.jobId);
  if (current?.timer) clearTimeout(current.timer);
  if (job.state !== "done" && !(keepPartial && job.state === "cancelled")) { active.delete(entry.jobId); return; }
  const files = jobResultFiles(job.result);
  if (!files.length) { active.delete(entry.jobId); return; }
  const outputDir = entry.outputDir;
  const sourceId = sourceFor(owner);
  for (const file of files) {
    const resolved = resolve(file.path);
    if (!resolved.startsWith(`${resolve(outputDir)}/`) || !existsSync(resolved)) continue;
    const bytes = new Uint8Array(readFileSync(resolved));
    const mediaType = file.media_type ?? "audio/mpeg";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileId = `file-${crypto.randomUUID().replaceAll("-", "")}`;
    const storagePath = `people/${owner.id}/attachments/${fileId}`;
    const destination = attachmentFilePath(storagePath);
    ensureDataDir(resolve(destination, ".."));
    const temporary = resolve(dirname(destination), `.${fileId}.radio-${entry.jobId.replace(/[^a-z0-9]/gi, "")}`);
    if (!existsSync(destination)) {
      await Bun.write(temporary, bytes);
    }
    const stored = storeFile(owner, { conversationId: null, turnId: null, mediaType, retention: "kept", provenance: `radio:recording:${entry.jobId}`, name: file.title ?? `${entry.station.name} recording`, staged: { path: temporary, size: bytes.byteLength, sha256 } });
    if (!stored.ok) continue;
    const now = new Date().toISOString();
    const id = newMediaItemId();
    db.insert(mediaItems).values({ id, kind: "track", title: file.title ?? `${entry.station.name} recording`, subtitle: entry.station.name, sourceId, locFileId: stored.value.id, mediaType, durationS: file.duration_s ?? null, size: stored.value.size, playable: "original", bandOk: "child", addedAt: now, createdAt: now, hlc: nextHlc(), provenance: `radio:recording:${entry.jobId}` }).run();
  }
  active.delete(entry.jobId);
}

export async function stopRadioRecording(person: PersonRow, stationId: string): Promise<RecordingOutcome<{ stopped: boolean }>> {
  const entry = [...active.values()].find((r) => r.personId === person.id && r.station.id === stationId);
  if (!entry) return error(404, "There is no recording in progress for this station.");
  if (entry.timer) clearTimeout(entry.timer);
  try {
    const stopped = await getStackClient().cancelJob(entry.jobId);
    if (stopped.state === "done" || stopped.state === "cancelled") await finish(entry, stopped, true);
  } catch { /* retrieve and keep any partial output below */ }
  if (active.has(entry.jobId)) await finish(entry);
  return { ok: true, value: { stopped: true } };
}


export function radioRecordingRows(person: PersonRow): Array<{ id: string; title: string; channel: string | null; summary: string; kind: "track"; thumbnail: null; backdrop: null; duration_s: number | null; copy_label: string }> {
  // Completed jobs are finalized on stop; this shelf lists only the person's own file backed items.
  void Promise.all([...active.values()].filter((entry) => entry.personId === person.id).map((entry) => finish(entry)));
  return db.select().from(mediaItems).where(and(eq(mediaItems.kind, "track"), isNull(mediaItems.deletedAt))).all()
    .filter((item) => item.provenance.startsWith("radio:recording:") && item.sourceId && db.select({ id: mediaSources.id }).from(mediaSources).where(and(eq(mediaSources.id, item.sourceId), eq(mediaSources.ownerPersonId, person.id))).get())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => ({ id: item.id, title: item.title, channel: item.subtitle, summary: item.subtitle ?? "Radio recording", kind: "track" as const, thumbnail: null, backdrop: null, duration_s: item.durationS, copy_label: "Saved" }));
}

export function radioRecordingItem(person: PersonRow, id: string): boolean {
  const item = readableItem(person, id);
  return Boolean(item?.provenance.startsWith("radio:recording:"));
}

registerMediaAppData("music", (person, dataId, params) => {
  if (dataId !== "radio-recordings" && (dataId !== "radio" || params.scope !== "recordings")) return null;
  return radioRecordingRows(person);
});

registerItemView("music", (person, item, view) => radioRecordingItem(person, item.id) ? { ...view, channel: item.subtitle, subtitle: item.subtitle, src: `/api/media/items/${encodeURIComponent(item.id)}/content` } : view);

export function __resetRadioRecordingsForTests(): void { for (const e of active.values()) if (e.timer) clearTimeout(e.timer); active.clear(); }
