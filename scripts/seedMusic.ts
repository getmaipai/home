// MUSIC-DEMO-01: demo music for the seeded household. Everything is made here at seed time and written to a folder in the dev data
// directory: short synthesized tunes (WAV with ID3 tags), a timed lyrics file beside each, and a generated cover per album. No audio or
// picture is stored in the repo, no real artist or song appears (persona-roster names only), and nothing is looked up outside.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

export interface DemoTrack { title: string; lines: string[]; }
export interface DemoAlbum { artist: string; album: string; year: number; genre: string; hue: number; tracks: DemoTrack[]; }

export const DEMO_ALBUMS: DemoAlbum[] = [
  { artist: "Velvet Atlas", album: "Paper Lanterns", year: 2023, genre: "Indie Pop", hue: 20, tracks: [
    { title: "Porch Light", lines: ["Porch light humming low", "We keep the evening slow", "Every window glows", "Nobody has to go"] },
    { title: "Paper Lanterns", lines: ["Lift them up and let them drift", "Over rooftops, soft and swift", "One more wish for you", "One more wish for me"] },
    { title: "Small Hours", lines: ["The kettle sings at two", "The street is washed in blue", "I hum a little tune", "Beneath a sleepy moon"] },
    { title: "Kitchen Dance", lines: ["Socks across the floor", "Spin me by the door", "Dinner can be late", "The song says wait"] },
  ] },
  { artist: "Velvet Atlas", album: "Window Seat", year: 2025, genre: "Indie Pop", hue: 200, tracks: [
    { title: "Window Seat", lines: ["Fields go rolling past", "Nothing lasts, nothing has to last", "Rest your head on me", "Count the roads with me"] },
    { title: "Station Clock", lines: ["Ten past nine again", "Platform full of rain", "Wave until you fade", "Wave until you fade"] },
    { title: "Low Tide", lines: ["Shells along the sand", "Footprints hand in hand", "Wash them all away", "We will come back someday"] },
  ] },
  { artist: "The Bramble Quartet", album: "Morning Fog", year: 2022, genre: "Chamber Folk", hue: 140, tracks: [
    { title: "Morning Fog", lines: ["Hills are wrapped in gray", "Wake the day slowly", "Birds are tuning up", "Wake the day slowly"] },
    { title: "Fiddle Road", lines: ["Follow the fiddle down", "Past the mill and out of town", "Stones beneath our feet", "Keep the tempo neat"] },
    { title: "Orchard Gate", lines: ["Apples in the grass", "Let the summer pass", "Latch the orchard gate", "Home before it is late"] },
    { title: "Lamp and Lullaby", lines: ["Close the book and rest", "Quiet is the best", "Lamp turned down low", "Dream the way you know"] },
  ] },
  { artist: "Indigo Rivet", album: "Night Shift", year: 2024, genre: "Electronic", hue: 265, tracks: [
    { title: "Night Shift", lines: ["Neon on the wet street", "Pulse beneath my feet", "City never sleeps", "Everything repeats"] },
    { title: "Signal Fire", lines: ["Send a light across the bay", "Send it all the way", "Someone will reply", "Under the same sky"] },
    { title: "Chrome Garden", lines: ["Flowers made of light", "Open in the night", "Water falls in time", "Every drop a rhyme"] },
  ] },
  { artist: "Clover Tempo", album: "Sunday Drive", year: 2021, genre: "Soft Rock", hue: 45, tracks: [
    { title: "Sunday Drive", lines: ["Windows down, no plan", "Radio and a thermos can", "Sun is on the glass", "Let the miles pass"] },
    { title: "Back Porch Blues", lines: ["Rocking chair and rain", "Singing it again", "Nothing much to fix", "Just the old six strings"] },
    { title: "Fireflies", lines: ["Count them in the yard", "Summer plays its card", "Jar them for a while", "Then let them go with a smile"] },
  ] },
];

const SAMPLE_RATE = 11025;
const NOTE_SECONDS = 0.5;
const SCALES = [[0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 2, 3, 5, 7, 8, 10]];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A short original tune: pentatonic or minor notes picked from the title, a sine with a soft second harmonic, faded in and out. */
export function synthTune(title: string, seconds = 24): Int16Array {
  const random = seededRandom(hashOf(title));
  const scale = SCALES[hashOf(title) % SCALES.length]!;
  const root = 196 * 2 ** ((hashOf(`${title}root`) % 7) / 12);
  const samples = new Int16Array(Math.floor(seconds * SAMPLE_RATE));
  const noteLength = Math.floor(NOTE_SECONDS * SAMPLE_RATE);
  let degree = 0;
  for (let start = 0; start < samples.length; start += noteLength) {
    degree = Math.max(0, Math.min(scale.length * 2 - 1, degree + Math.floor(random() * 5) - 2));
    const semitones = scale[degree % scale.length]! + 12 * Math.floor(degree / scale.length);
    const frequency = root * 2 ** (semitones / 12);
    const rest = random() < 0.12;
    for (let i = 0; i < noteLength && start + i < samples.length; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.min(1, i / 400) * Math.exp(-2.2 * t);
      const wave = Math.sin(2 * Math.PI * frequency * t) + 0.3 * Math.sin(4 * Math.PI * frequency * t);
      const fade = Math.min(1, (start + i) / 2000, (samples.length - start - i) / 6000);
      samples[start + i] = rest ? 0 : Math.round(wave * envelope * fade * 9000);
    }
  }
  return samples;
}

function id3Frame(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.write(id, 0, "latin1");
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}
const textFrame = (id: string, value: string): Buffer => id3Frame(id, Buffer.concat([Buffer.from([1]), Buffer.from(`﻿${value}`, "utf16le"), Buffer.from([0, 0])]));

function id3Tag(fields: { title: string; artist: string; album: string; year: number; genre: string; track: number }): Buffer {
  const frames = Buffer.concat([
    textFrame("TIT2", fields.title), textFrame("TPE1", fields.artist), textFrame("TPE2", fields.artist), textFrame("TALB", fields.album),
    textFrame("TYER", String(fields.year)), textFrame("TCON", fields.genre), textFrame("TRCK", String(fields.track)),
  ]);
  const size = frames.length;
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  return Buffer.concat([header, frames]);
}

export function wavWithId3(samples: Int16Array, tag: Buffer): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "latin1"); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(SAMPLE_RATE, 12); fmt.writeUInt32LE(SAMPLE_RATE * 2, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const chunk = (id: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.write(id, 0, "latin1"); head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([Buffer.from("WAVE", "latin1"), fmt, chunk("data", data), chunk("id3 ", tag)]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1"); riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A square cover: a two-colour diagonal gradient from the album's hue, a large soft circle and a few bands, all computed. */
export function coverPng(hue: number, seed: string, size = 480): Buffer {
  const random = seededRandom(hashOf(seed));
  const top = hslToRgb(hue, 0.65, 0.55);
  const bottom = hslToRgb((hue + 50) % 360, 0.7, 0.28);
  const accent = hslToRgb((hue + 180) % 360, 0.75, 0.7);
  const cx = size * (0.3 + random() * 0.4), cy = size * (0.3 + random() * 0.4), radius = size * (0.18 + random() * 0.12);
  const bandAt = size * (0.62 + random() * 0.2), bandHeight = size * 0.05;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const mix = (x + y) / (2 * size);
      let pixel = [0, 1, 2].map((i) => top[i]! * (1 - mix) + bottom[i]! * mix);
      if (Math.hypot(x - cx, y - cy) < radius) pixel = pixel.map((v, i) => v * 0.25 + accent[i]! * 0.75);
      else if (Math.abs(y - bandAt) < bandHeight && (x + y) % 40 < 28) pixel = pixel.map((v, i) => v * 0.6 + accent[i]! * 0.4);
      const at = y * (size * 3 + 1) + 1 + x * 3;
      raw[at] = pixel[0]!; raw[at + 1] = pixel[1]!; raw[at + 2] = pixel[2]!;
    }
  }
  const part = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0); head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), part("IHDR", ihdr), part("IDAT", deflateSync(raw)), part("IEND", Buffer.alloc(0))]);
}

const lrcStamp = (seconds: number): string => `[${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}]`;

/** Writes `Artist/Album/NN Title.wav`, a same-name `.lrc`, and `cover.png` per album under `root`. Returns the file count written. */
export function writeDemoMusic(root: string, albums: readonly DemoAlbum[] = DEMO_ALBUMS): number {
  let files = 0;
  for (const album of albums) {
    const dir = join(root, album.artist, album.album);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cover.png"), coverPng(album.hue, `${album.artist}${album.album}`)); files++;
    album.tracks.forEach((track, index) => {
      const number = index + 1;
      const base = `${String(number).padStart(2, "0")} ${track.title}`;
      const tag = id3Tag({ title: track.title, artist: album.artist, album: album.album, year: album.year, genre: album.genre, track: number });
      writeFileSync(join(dir, `${base}.wav`), wavWithId3(synthTune(`${album.artist}${track.title}`), tag)); files++;
      writeFileSync(join(dir, `${base}.lrc`), track.lines.map((line, at) => `${lrcStamp(2 + at * 5.5)} ${line}`).join("\n") + "\n"); files++;
    });
  }
  return files;
}
