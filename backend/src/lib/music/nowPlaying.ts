import type { PersonRow } from "@/types";
import { isDeviceConnected, listRobotsPairedUnderPerson } from "@/lib/deviceCommands";
import { getDeviceState } from "@/lib/deviceStates";
import { listDevicesByKind } from "@/lib/devices";
import { mediaBandOf } from "@/lib/media/band";
import { getMusicJobFor } from "@/lib/music/store";
import { musicJobLockState } from "@/lib/music/lock";
import { clearNowPlaying, noteNowPlaying } from "@/lib/music/heardSong";
import { sendSongTitle, shownTitle } from "@/lib/songNameTool";

export type NowPlayingInput = { state: "playing" | "stopped"; song_id?: string; key?: string; title?: string; artist?: string; album?: string; year?: number };
type Entry = { title: string; artist?: string; album?: string; year?: number; at: number; expiresAt: number; robotIds: string[] };
const entries = new Map<string, Entry>();
const lastText = new Map<string, string>();
const TTL = 150_000;
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f<>\[\]{}|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
function robotsFor(person: PersonRow): string[] {
  const own = listRobotsPairedUnderPerson(person.id);
  return own.length || mediaBandOf(person) !== "adult" ? own : listDevicesByKind("robot").map((robot) => robot.id);
}
function push(person: PersonRow, text: string): number {
  let changed = 0;
  for (const id of robotsFor(person)) {
    const state = getDeviceState(id);
    if (!isDeviceConnected(id) || !state || state.muted) continue;
    if (lastText.get(id) === text) continue;
    sendSongTitle(id, text);
    if (text) lastText.set(id, text); else lastText.delete(id);
    changed++;
  }
  return changed;
}
function clear(person: PersonRow): number {
  entries.delete(person.id);
  for (const id of robotsFor(person)) { clearNowPlaying(id); lastText.delete(id); }
  return push(person, "");
}
export function reportNowPlaying(person: PersonRow, input: NowPlayingInput, now = Date.now()): { ok: true; pushed: number } {
  try {
    if (input.state === "stopped") return { ok: true, pushed: clear(person) };
    let title = input.title ?? "", artist = input.artist, album = input.album, year = input.year;
    const job = input.song_id ? getMusicJobFor(person, input.song_id) : null;
    if (job) {
      if (musicJobLockState(job, person) !== "open") return { ok: true, pushed: clear(person) };
      title = job.request.title || title;
      artist = job.request.band?.name || undefined;
      album = undefined;
      year = undefined;
    }
    title = clean(title);
    if (!title) return { ok: true, pushed: clear(person) };
    const robotIds = robotsFor(person);
    const entry: Entry = { title, ...(artist ? { artist: clean(artist) } : {}), ...(album ? { album: clean(album) } : {}), ...(year ? { year } : {}), at: now, expiresAt: now + TTL, robotIds };
    entries.set(person.id, entry);
    let pushed = 0;
    for (const id of robotIds) {
      noteNowPlaying(id, entry, now);
      const state = getDeviceState(id);
      if (!isDeviceConnected(id) || !state || state.muted) continue;
      const text = clean(shownTitle(entry));
      if (lastText.get(id) !== text) { sendSongTitle(id, text); lastText.set(id, text); pushed++; }
    }
    return { ok: true, pushed };
  } catch { return { ok: true, pushed: 0 }; }
}
export function sweepNowPlaying(now = Date.now()): void {
  for (const [personId, entry] of entries) if (entry.expiresAt <= now) {
    entries.delete(personId);
    const personRobots = entry.robotIds;
    for (const id of personRobots) clearNowPlaying(id);
    for (const id of personRobots) if (isDeviceConnected(id) && !getDeviceState(id)?.muted && lastText.has(id)) { sendSongTitle(id, ""); lastText.delete(id); }
  }
}
export function __resetNowPlayingForTests(): void { entries.clear(); lastText.clear(); }
