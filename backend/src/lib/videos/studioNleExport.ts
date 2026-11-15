import { newItemMark } from "@/lib/adultLock";
import type { PersonRow } from "@/types";
import { resolveStudioPlan } from "./studioExport";
import { writeEdl, writeFcpxml, writeZip, type NleClip } from "./nleExport";

const README = `MaiPai Studio timeline export\n\nDaVinci Resolve: extract this ZIP, then import the .fcpxml using File > Import Timeline > Import AAF/EDL/XML. Keep the source files beside the timeline.\n\nPremiere Pro: extract this ZIP and import the .edl with File > Import. Relink to the source files in this folder if prompted. Premiere can also import FCPXML through an XML translation workflow.\n\nAfter Effects: After Effects does not import EDL or FCPXML directly. Import the EDL through Premiere, or import the FCPXML through Resolve, then move the timeline onward.\n`;
const safeName = (s: string) => s.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 70) || "clip";

export async function makeStudioNleExport(person: PersonRow, body: Record<string, unknown>) {
  const resolved = await resolveStudioPlan(person, body);
  if (!resolved.ok) return resolved;
  const r = resolved.value; const clips: NleClip[] = []; const files: Array<{ name: string; bytes: Uint8Array }> = [];
  const add = (name: string, file: { bytes: Uint8Array; ext: string }, in_s: number, out_s: number, track: number, start_s = 0) => {
    const path = `media/${String(clips.length + 1).padStart(3, "0")}_${safeName(name)}.${safeName(file.ext)}`;
    files.push({ name: path, bytes: file.bytes });
    clips.push({ name, path, in_s, out_s, track, frameRate: 24, start_s });
  };
  let videoStart = 0;
  r.plan.video.pieces.forEach((piece, i) => {
    const transition = r.plan.video.transitions[i - 1];
    if (i > 0 && transition?.kind === "crossfade") videoStart -= transition.seconds;
    add(`Video ${i + 1}`, r.videoFiles[i]!, piece.in_s, piece.out_s, 1, videoStart);
    videoStart += piece.out_s - piece.in_s;
  });
  r.plan.music.pieces.forEach((piece, i) => { if (!r.plan.music.muted) add(`Music ${i + 1}`, r.musicFiles[i]!, piece.in_s, piece.out_s, 2, piece.start_s); });
  r.plan.voice.pieces.forEach((piece, i) => { if (!r.plan.voice.muted) add(`Voice ${i + 1}`, r.voiceFiles[i]!, piece.in_s, piece.out_s, 3, piece.start_s); });
  // Studio-generated video is 24 fps.
  const timeline = { clips, frameRate: 24 };
  const mark = newItemMark(r.marks, false);
  const readme = new TextEncoder().encode(README);
  const payload = writeZip([
    { name: "Studio.edl", bytes: new TextEncoder().encode(writeEdl(timeline)) },
    { name: "Studio.fcpxml", bytes: new TextEncoder().encode(writeFcpxml(timeline)) },
    { name: "README.txt", bytes: readme }, ...files,
  ]);
  return { ok: true as const, bytes: payload, mark, filename: "studio-timeline.zip" };
}

