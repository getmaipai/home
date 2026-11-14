import type { PersonRow } from "@/types";
import { isDeviceConnected, listRobotsPairedUnderPerson } from "@/lib/deviceCommands";
import { getDeviceState } from "@/lib/deviceStates";
import { mediaBandOf } from "@/lib/media/band";
import { robotCompanionBand, stricterBand } from "@/lib/robotCompanion";
import { evaluateSafety, forOutput } from "@/lib/safety";
import { getMusicJobFor } from "@/lib/music/store";
import { musicJobLockItem, musicJobLockState } from "@/lib/music/lock";
import { clearNowPlaying, noteNowPlaying } from "@/lib/music/heardSong";
import { sendSongTitle, shownTitle } from "@/lib/songNameTool";

export type NowPlayingInput = { state: "playing" | "stopped"; song_id?: string; key?: string; title?: string; artist?: string; album?: string; year?: number };
type Entry = { title: string; artist?: string; album?: string; year?: number; at: number; expiresAt: number; robotIds: string[] };
const entries = new Map<string, Entry>();
const lastText = new Map<string, string>();
const TTL = 150_000;
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f<>\[\]{}|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
/** A person's activity stays theirs: only the robots paired to the person who is playing (RULES.md, the org privacy rule). No fallback to the household's other robots. */
export function robotsFor(person: PersonRow): string[] {
  return listRobotsPairedUnderPerson(person.id);
}
/** Face text and heard-song context pass the stricter of the player's band and the band the robot gives an unknown speaker: its controls level when a companion is assigned, else child (RULES.md rule 0, robot paragraph). */
export function titleAllowedFor(person: PersonRow, robotId: string, text: string): boolean {
  try {
    const band = stricterBand(mediaBandOf(person), robotCompanionBand(robotId) ?? "child");
    if (band === "adult") return true;
    const checked = forOutput(evaluateSafety(text, band, "reply"));
    return checked.action === "allow" && !checked.flagged;
  } catch { return false; }
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
  for (const id of robotsFor(person)) clearNowPlaying(id);
  return push(person, "");
}
export function reportNowPlaying(person: PersonRow, input: NowPlayingInput, now = Date.now()): { ok: true; pushed: number } {
  try {
    if (input.state === "stopped") return { ok: true, pushed: clear(person) };
    // The title is looked up on the server from the person's own song record; a client-supplied title, artist or album is never shown.
    const job = input.song_id ? getMusicJobFor(person, input.song_id) : null;
    if (!job) return { ok: true, pushed: clear(person) };
    if (musicJobLockState(job, person) !== "open") return { ok: true, pushed: clear(person) };
    const title = clean(job.request.title || "");
    const artist = job.request.band?.name || undefined;
    const album = undefined as string | undefined, year = undefined as number | undefined;
    if (!title) return { ok: true, pushed: clear(person) };
    const item = musicJobLockItem(job);
    const adultOnly = item?.madeAudience === "adult-only";
    const text = [title, artist].filter(Boolean).join(" ");
    const paired = robotsFor(person);
    const robotIds = adultOnly ? [] : paired.filter((id) => titleAllowedFor(person, id, text));
    const refused = paired.filter((id) => !robotIds.includes(id));
    for (const id of refused) {
      clearNowPlaying(id);
      if (lastText.has(id)) { sendSongTitle(id, ""); lastText.delete(id); }
    }
    if (!robotIds.length) { entries.delete(person.id); return { ok: true, pushed: 0 }; }
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
