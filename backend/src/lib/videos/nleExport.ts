/** Pure interchange writers for a Studio timeline. Time is quantized to the timeline's frame rate. */
export interface NleClip { name: string; path?: string; in_s: number; out_s: number; track: number; frameRate: number; start_s?: number }
export interface NleTimeline { clips: NleClip[]; frameRate: number }

const tc = (seconds: number, fps: number): string => {
  const frames = Math.max(0, Math.round(seconds * fps));
  const f = frames % fps; const totalSeconds = Math.floor(frames / fps);
  return `${String(Math.floor(totalSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
};
const xml = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const rational = (frames: number, fps: number): string => `${Math.max(0, Math.round(frames))}/${fps}s`;

export function writeEdl(timeline: NleTimeline): string {
  const fps = timeline.frameRate;
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error("Invalid frame rate");
  const tracks = [...new Set(timeline.clips.map((c) => c.track))].sort((a, b) => a - b);
  let eventNumber = 0;
  return tracks.map((track) => {
    const clips = timeline.clips.filter((c) => c.track === track);
    let cursor = 0;
    const events = clips.map((clip, i) => {
      const duration = Math.round((clip.out_s - clip.in_s) * fps);
      if (duration <= 0) throw new Error("Invalid clip duration");
      const start = Math.round((clip.start_s ?? cursor / fps) * fps); cursor = start + duration;
      eventNumber++;
      return `${String(eventNumber).padStart(3, "0")}  AX       ${track === 1 ? "V" : "A"}     C        ${tc(clip.in_s, fps)} ${tc(clip.out_s, fps)} ${tc(start / fps, fps)} ${tc(cursor / fps, fps)}\n* FROM CLIP NAME: ${(clip.path ?? clip.name).replace(/[\r\n]/g, " ")}`;
    });
    return [`TITLE: MaiPai Studio`, `FCM: NON-DROP FRAME`, ...events].join("\n");
  }).join("\n\n") + "\n";
}

export function writeFcpxml(timeline: NleTimeline): string {
  const fps = timeline.frameRate;
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error("Invalid frame rate");
  let cursor = 0;
  const video = timeline.clips.filter((c) => c.track === 1);
  const audio = timeline.clips.filter((c) => c.track > 1);
  const all = [...video, ...audio];
  const resources = all.map((c, i) => `    <asset id="r${i + 1}" name="${xml(c.name)}" src="file://${xml(c.path ?? c.name)}" start="${rational(Math.round(c.in_s * fps), fps)}" duration="${rational(Math.round((c.out_s - c.in_s) * fps), fps)}" hasVideo="1" hasAudio="1"/>`).join("\n");
  const clips = video.map((c, i) => {
    const duration = Math.round((c.out_s - c.in_s) * fps); const offset = Math.round((c.start_s ?? cursor / fps) * fps); cursor = Math.max(cursor, offset + duration);
    return `            <asset-clip name="${xml(c.name)}" ref="r${i + 1}" offset="${rational(offset, fps)}" start="${rational(Math.round(c.in_s * fps), fps)}" duration="${rational(duration, fps)}"/>`;
  }).join("\n");
  const audioClips = audio.map((c, i) => `          <asset-clip name="${xml(c.name)}" ref="r${video.length + i + 1}" offset="${rational(Math.round((c.start_s ?? 0) * fps), fps)}" start="${rational(Math.round(c.in_s * fps), fps)}" duration="${rational(Math.round((c.out_s - c.in_s) * fps), fps)}"/>`).join("\n");
  const audioStory = audioClips ? `\n        <gap name="Audio lane" offset="0/1s" duration="${rational(cursor, fps)}"><audio>${audioClips}</audio></gap>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9">\n  <resources>\n${resources}\n    <format id="r0" name="FFVideoFormat${fps}p" frameDuration="1/${fps}s"/>\n  </resources>\n  <library><event name="MaiPai Studio"><project name="Studio Export"><sequence format="r0" duration="${rational(cursor, fps)}" tcStart="0/1s" tcFormat="NDF"><spine>\n${clips}${audioStory}\n      </spine></sequence></project></event></library>\n</fcpxml>\n`;
}

/** Small store-only ZIP writer, avoiding a runtime dependency and keeping source bytes intact. */
export function writeZip(files: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder(); const locals: Uint8Array[] = []; const centrals: Uint8Array[] = []; let offset = 0;
  const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255]; const u32 = (v: number) => [...u16(v), ...u16(v >>> 16)];
  for (const file of files) {
    const name = enc.encode(file.name); const data = file.bytes; const crc = crc32(data);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data]); locals.push(local);
    centrals.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name])); offset += local.length;
  }
  const central = concat(centrals); const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(offset), ...u16(0)]);
  return concat([...locals, central, end]);
}
function concat(chunks: Uint8Array[]): Uint8Array { const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; } return out; }
