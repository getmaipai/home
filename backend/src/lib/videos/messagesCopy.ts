// VIDEOSHARE-01: the copy of a clip a person texts. The Stack makes every new clip with a silent AAC track and a title, so
// the stored file is usually ready as it is; a clip stored before that has no sound track and is converted by the Stack
// (POST /v1/videos/messages, nothing kept there) and kept here in memory for a few minutes. The name comes from the
// prompt ("a paper boat in the rain" becomes paper-boat-in-the-rain.mp4), never "video.mp4".
import { convertForMessages } from "@/lib/videos/stack";

const FILLER = new Set(["a", "an", "the", "of", "and", "to", "in", "on", "with", "for", "please", "make", "me", "video", "clip", "movie"]);

/** A readable file name from what the person asked for: up to six words, lower case, letters and digits, `.mp4` on the end. */
export function videoFileName(prompt: string): string {
  const words = prompt.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const kept = words.filter((word) => !FILLER.has(word));
  // A prompt of only filler words keeps its own words rather than falling back to a bare "video".
  const chosen = (kept.length > 0 ? kept : words).slice(0, 6);
  let name = chosen.join("-").slice(0, 48).replace(/-+$/, "");
  if (name === "") name = "video";
  return `${name}.mp4`;
}

/** The title written into the file: the prompt's first 80 characters, one line. */
export function videoTitle(prompt: string): string {
  const line = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
  return line === "" ? "MaiPai video" : line;
}

/** True when the mp4 has a sound track: a `hdlr` box whose handler type is `soun`. */
export function hasAudioTrack(bytes: Uint8Array): boolean {
  const tag = [0x68, 0x64, 0x6c, 0x72]; // hdlr
  const soun = [0x73, 0x6f, 0x75, 0x6e];
  outer: for (let i = 0; i + 16 <= bytes.length; i += 1) {
    if (bytes[i] !== tag[0]) continue;
    for (let k = 1; k < 4; k += 1) if (bytes[i + k] !== tag[k]) continue outer;
    if (soun.every((value, k) => bytes[i + 12 + k] === value)) return true;
  }
  return false;
}

const kept = new Map<string, { bytes: Uint8Array; at: number }>();
const KEEP_MS = 10 * 60_000;
const KEEP_MAX = 4;

/** The bytes to send: the stored clip when it already has sound, otherwise the Stack's converted copy. */
export async function messagesCopyOf(fileId: string, bytes: Uint8Array, title: string): Promise<Uint8Array> {
  if (hasAudioTrack(bytes)) return bytes;
  const now = Date.now();
  for (const [key, value] of kept) if (now - value.at > KEEP_MS) kept.delete(key);
  const hit = kept.get(fileId);
  if (hit) return hit.bytes;
  const out = await convertForMessages(bytes, title);
  kept.set(fileId, { bytes: out, at: now });
  while (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value as string);
  return out;
}

export function __resetMessagesCopiesForTests(): void { kept.clear(); }
