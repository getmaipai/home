import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Line, Script, CastMember } from "@/lib/talent/types";
import type { ShowFormat } from "@maipai/spec/gen/ts/show-format.js";
import { toSpokenText } from "@/lib/spokenText";
import { planVoiceCues, freshCueState, sanitizeSpeechTags } from "@/lib/voiceCues";
import { getStackClient } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { audioSeconds } from "@/lib/videos/audioLength";

export interface RenderedLine { line_id: string; part: string; clip_path: string; duration_ms: number; sha256: string; split?: { before: RenderedLine; after: RenderedLine } }
export interface EditTrack { path: string; start_ms: number; gain_db: number; fade_in_ms: number; fade_out_ms: number; end_ms?: number }
type Chapter = { start_ms: number; title: string };

function spokenFor(line: Line, voiceTags: readonly string[], minor: boolean, filler: CastMember["persona"]["filler_density"]): string {
  const normalized = toSpokenText(line.text);
  const level = filler === "none" ? "off" : filler === "light" ? "light" : "natural";
  const cues = planVoiceCues({ text: normalized, turnId: `talent:${line.part}:${line.text}`, level, band: minor ? "child" : "adult", supportedTags: voiceTags, state: freshCueState() });
  const tagged = cues.text.replace(/\s*\[([\w -]+)\]\s*/g, (_all, tag: string) => ` [${tag}] `).trim();
  const delivery = line.delivery.tags.filter((tag) => voiceTags.includes(tag)).map((tag) => `[${tag}]`).join(" ");
  return sanitizeSpeechTags(`${tagged}${delivery ? ` ${delivery}` : ""}`, voiceTags);
}
export function speakableText(line: Line, voiceTags: readonly string[]): string { return spokenFor(line, voiceTags, false, "frequent"); }

export function splitAtWord(text: string, word: number): [string, string] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const at = Math.max(1, Math.min(Math.floor(word) - 1, words.length - 1));
  return [words.slice(0, at).join(" "), words.slice(at).join(" ")];
}

function jobResult(job: { state: string; result?: unknown; reason?: string | null }, description: string): Record<string, unknown> {
  if (job.state === "failed" || job.state === "cancelled") throw new Error(`${description} ${job.reason ?? "The Stack job failed."} Try again or change the voice.`);
  if (job.state !== "done" || !job.result || typeof job.result !== "object") throw new Error(`${description} The Stack returned no completed result. Try again.`);
  return job.result as Record<string, unknown>;
}

async function waitForIdle(stack: StackClient, signal?: AbortSignal): Promise<void> {
  const idle = (stack as StackClient & { waitForIdle?: (opts?: { signal?: AbortSignal }) => Promise<void> }).waitForIdle;
  if (idle) await idle.call(stack, { signal });
}

export async function renderLines(script: Script, cast: CastMember[], outDir: string, stack = getStackClient(), signal?: AbortSignal): Promise<RenderedLine[]> {
  const castByPart = new Map<string, CastMember>(cast.map((member) => [member.part, member]));
  const offeredVoices = typeof stack.voices === "function" ? await stack.voices().catch(() => []) : [];
  const tagsFor = (voice: string) => (offeredVoices.find((item) => item.id === voice) as (typeof offeredVoices)[number] & { tags?: string[] } | undefined)?.tags ?? [];
  const requests: Array<{ id: string; line_id: string; part: string; text: string; voice_url: string; pitch_semitones?: number; backchannel?: boolean }> = [];
  for (let seg = 0; seg < script.segments.length; seg++) for (let index = 0; index < script.segments[seg]!.lines.length; index++) {
    const line = script.segments[seg]!.lines[index]!; const id = `${seg + 1}-${index + 1}`;
    const speaker = castByPart.get(line.part);
    if (!speaker) throw new Error(`Line ${id} uses an unknown cast part. Add that part to the show cast and try again.`);
    const cut = line.timing.talked_over === null ? null : line.timing.cut_in_at_word;
    const pieces = cut === null ? [line.text] : splitAtWord(line.text, cut);
    pieces.forEach((piece, partIndex) => requests.push({ id: pieces.length === 2 ? `${id}-${partIndex === 0 ? "a" : "b"}` : id, line_id: id, part: line.part, text: spokenFor({ ...line, text: piece }, tagsFor(speaker.voice), speaker.minor, speaker.persona.filler_density), voice_url: speaker.voice }));
    for (const back of line.timing.backchannels) {
      const member = castByPart.get(back.part);
      if (!member) throw new Error(`Line ${id} has a backchannel from an unknown cast part. Add that part to the show cast and try again.`);
      const hash = createHash("sha256").update(`${back.part}:${back.text}`).digest("hex").slice(0, 12);
      const key = `bc-${back.part}-${hash}`;
      if (!requests.some((row) => row.id === key)) requests.push({ id: key, line_id: key, part: back.part, text: spokenFor({ ...line, part: back.part, text: back.text }, tagsFor(member.voice), member.minor, member.persona.filler_density), voice_url: member.voice, backchannel: true });
    }
  }
  const rendered: RenderedLine[] = [];
  for (let offset = 0; offset < requests.length; offset += 400) {
    if (offset > 0) await waitForIdle(stack, signal);
    if (signal?.aborted) throw signal.reason ?? new Error("Line rendering was cancelled. Try again.");
    const batch = requests.slice(offset, offset + 400);
    // Let the Stack keep these files in its job folder; the returned paths are used directly.
    const submitted = await stack.submitJob({ kind: "media.tts", input: { lines: batch.map(({ id, text, voice_url }) => ({ id, text, voice_url })), output: {} } }, { signal });
    let job = submitted;
    while (job.state !== "done" && job.state !== "failed" && job.state !== "cancelled") {
      if (signal?.aborted) { await stack.cancelJob(job.id); throw signal.reason ?? new Error("Line rendering was cancelled. Try again."); }
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 2000); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); });
      job = await stack.job(job.id, { signal });
    }
    const result = jobResult(job, "The speech batch could not be rendered.");
    const rows = result.lines;
    if (!Array.isArray(rows)) throw new Error("The speech batch returned no line files. Try again.");
    const byId = new Map(rows.map((row) => [(row as { id?: string }).id, row as { id: string; path: string; duration_s: number; sha256: string }]));
    for (const request of batch) {
      const row = byId.get(request.id);
      if (!row || typeof row.path !== "string" || !Number.isFinite(row.duration_s)) throw new Error(`Line ${request.id} returned no audio file. Try again or change the voice.`);
      rendered.push({ line_id: request.line_id, part: request.part, clip_path: row.path, duration_ms: Math.round(row.duration_s * 1000), sha256: row.sha256 });
    }
  }
  const grouped = new Map<string, RenderedLine[]>();
  for (const row of rendered) grouped.set(row.line_id, [...(grouped.get(row.line_id) ?? []), row]);
  return [...grouped.entries()].map(([lineId, rows]) => {
    if (rows.length < 2 || !requests.some((request) => request.line_id === lineId && request.id.endsWith("-a"))) return rows[0]!;
    const before = rows.find((row) => row.clip_path.endsWith(`${lineId}-a.wav`)) ?? rows[0]!;
    const after = rows.find((row) => row !== before)!;
    return { ...before, split: { before, after } };
  });
}

export function layout(script: Script, rendered: RenderedLine[], format: ShowFormat): { tracks: EditTrack[]; chapters: Chapter[]; total_ms: number } {
  const clips = new Map<string, RenderedLine[]>();
  for (const item of rendered) {
    const parts = item.split ? [item.split.before, item.split.after] : [item];
    for (const part of parts) clips.set(item.line_id, [...(clips.get(item.line_id) ?? []), part]);
  }
  const tracks: EditTrack[] = [], chapters: Chapter[] = []; let cursor = 0;
  const overlapDefault: Record<string, number> = { light: 300, lively: 450, heated: 650 };
  for (let seg = 0; seg < script.segments.length; seg++) {
    const segment = script.segments[seg]!;
    const segmentStart = cursor;
    for (let index = 0; index < segment.lines.length; index++) {
      const line = segment.lines[index]!; const id = `${seg + 1}-${index + 1}`;
      const lineClips = clips.get(id) ?? [];
      const hasSplit = line.timing.cut_in_at_word !== null && line.timing.talked_over !== null && lineClips.length >= 2;
      const split = hasSplit && format.talk_over !== "none";
      const start = cursor;
      let end: number;
      if (split) {
        const before = lineClips[0]!, after = lineClips[1]!;
        tracks.push({ path: before.clip_path, start_ms: start, gain_db: 0, fade_in_ms: 0, fade_out_ms: 0 });
        // The interrupter can start no earlier than the interrupted clip itself: a short clip caps the overlap.
        const overlap = Math.min(before.duration_ms, line.timing.overlap_ms ?? overlapDefault[format.talk_over] ?? 0);
        end = start + before.duration_ms - overlap;
        if (line.timing.talked_over === "continue") {
          tracks.push({ path: after.clip_path, start_ms: start + before.duration_ms, gain_db: -6, fade_in_ms: 0, fade_out_ms: 300, end_ms: Math.min(after.duration_ms, 1500) });
        }
      } else if (hasSplit) {
        const before = lineClips[0]!, after = lineClips[1]!;
        tracks.push({ path: before.clip_path, start_ms: start, gain_db: 0, fade_in_ms: 0, fade_out_ms: 0 });
        tracks.push({ path: after.clip_path, start_ms: start + before.duration_ms, gain_db: 0, fade_in_ms: 0, fade_out_ms: 0 });
        end = start + before.duration_ms + after.duration_ms;
      } else {
        const clip = lineClips[0];
        if (!clip) throw new Error(`Line ${id} has no rendered clip. Render the script before laying it out.`);
        tracks.push({ path: clip.clip_path, start_ms: start, gain_db: 0, fade_in_ms: 0, fade_out_ms: 0 });
        end = start + clip.duration_ms;
      }
      for (const back of line.timing.backchannels) {
        const hash = createHash("sha256").update(`${back.part}:${back.text}`).digest("hex").slice(0, 12);
        const clip = clips.get(`bc-${back.part}-${hash}`)?.[0];
        if (clip) tracks.push({ path: clip.clip_path, start_ms: start + Math.round((lineClips[0]?.duration_ms ?? 0) * back.word_index / Math.max(1, line.text.trim().split(/\s+/).length)), gain_db: -10, fade_in_ms: 0, fade_out_ms: 0 });
      }
      cursor = split ? end : end + (line.timing.gap_ms ?? format.gap_ms);
    }
    if (segment.lines.length) chapters.push({ start_ms: segmentStart, title: segment.goal.slice(0, 60) });
  }
  const durations = new Map(rendered.map((item) => [item.clip_path, item.duration_ms]));
  return { tracks, chapters, total_ms: tracks.reduce((end, track) => Math.max(end, track.start_ms + Math.min(durations.get(track.path) ?? 0, track.end_ms ?? Number.POSITIVE_INFINITY)), 0) };
}

export async function mixEpisode(tracks: EditTrack[], chapters: Chapter[], stingers: { intro: string | null; outro: string | null }, outPath: string, stack = getStackClient()): Promise<{ path: string; duration_s: number }> {
  const durationOf = async (path: string): Promise<number> => {
    try { const bytes = await readFile(path); return Math.round((audioSeconds(bytes) ?? 0) * 1000); }
    catch { return 0; }
  };
  const introDuration = stingers.intro ? (await durationOf(stingers.intro)) || 6000 : 0;
  const shift = stingers.intro ? Math.max(0, introDuration - 1500) : 0;
  const inputs = tracks.map((track) => ({ ...track, start_ms: track.start_ms + shift }));
  const duckUnder: number[] = tracks.map((_track, index) => index);
  if (stingers.intro) inputs.push({ path: stingers.intro, start_ms: 0, gain_db: 0, fade_in_ms: 0, fade_out_ms: 1500, end_ms: 6000 });
  const lastLineEnd = await Promise.all(tracks.map(async (track) => track.start_ms + Math.min(await durationOf(track.path), track.end_ms ?? Number.POSITIVE_INFINITY))).then((ends) => Math.max(0, ...ends));
  if (stingers.outro) inputs.push({ path: stingers.outro, start_ms: Math.max(0, lastLineEnd - 1000) + shift, gain_db: 0, fade_in_ms: 800, fade_out_ms: 0, end_ms: 6000 });
  // Let the Stack keep the mix in its job folder; only the requested filename matters.
  const name = outPath.split("/").at(-1)!;
  const submitted = await stack.submitJob({ kind: "media.mix", input: { tracks: inputs, duck: stingers.intro ? { under: duckUnder, by_db: 8 } : null, loudness_lufs: -16, output: { name }, chapters } });
  let job = submitted;
  while (job.state !== "done" && job.state !== "failed" && job.state !== "cancelled") { await new Promise((resolve) => setTimeout(resolve, 2000)); job = await stack.job(job.id); }
  const result = jobResult(job, "The episode mix could not be completed.");
  if (typeof result.path !== "string" || typeof result.duration_s !== "number") throw new Error("The episode mix returned no audio file. Try again.");
  return { path: result.path, duration_s: result.duration_s };
}
