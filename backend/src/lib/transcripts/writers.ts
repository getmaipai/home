import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import type { Cue } from "./cues";

function stamp(seconds: number, comma: boolean): string {
  // Round once before splitting fields so 59.9996 correctly rolls into the next minute.
  const ms = Math.round(seconds * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const separator = comma ? "," : ".";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function writeSrt(cues: readonly Cue[]): string {
  return cues.map((cue, index) =>
    `${index + 1}\n${stamp(cue.start, true)} --> ${stamp(cue.end, true)}\n${cue.text}\n`,
  ).join("\n");
}

export function writeVtt(cues: readonly Cue[]): string {
  const entries = cues.map((cue) =>
    `${stamp(cue.start, false)} --> ${stamp(cue.end, false)}\n${cue.text}\n`,
  ).join("\n");
  return `WEBVTT\n\n${entries}`;
}

export function writeText(transcript: Transcript): string {
  return transcript.segments.map((segment) => segment.text).join("\n");
}

export function writeMarkdown(transcript: Transcript): string {
  const names = new Map(transcript.speakers.map((speaker) => [speaker.id, speaker.label]));
  return transcript.segments.map((segment) => {
    const label = segment.speaker ? ` **${names.get(segment.speaker) ?? segment.speaker}:**` : "";
    return `- ${stamp(segment.start, false)}${label} ${segment.text}`;
  }).join("\n");
}

export function writeJson(transcript: Transcript): string {
  return JSON.stringify(transcript, null, 2);
}
