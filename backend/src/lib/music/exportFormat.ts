// MP-04: download a saved song as wav or flac. ffmpeg runs here, in Home, on a copy of the saved m4a; the file is never changed and nothing is stored.
// m4a is the saved file itself (the existing export route). Callers check the Adult lock and ownership before they read the bytes (`readMusicFile` does both).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { musicAudioTools, run } from "./mixParts";

export const EXPORT_FORMATS = ["wav", "flac"] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];
export const EXPORT_MEDIA_TYPE: Record<ExportFormat, string> = { wav: "audio/wav", flac: "audio/flac" };
export const EXPORT_UNAVAILABLE_LINE = "This computer has no audio tool to save the song in another format. Install ffmpeg, or download the m4a.";
export const EXPORT_FAILED_LINE = "The song could not be saved in that format. Try again, or download the m4a.";

/** Convert m4a bytes. Throws "export_unavailable" with no ffmpeg and "export_failed" when no file comes out. */
export async function convertSong(bytes: Uint8Array, format: ExportFormat): Promise<Uint8Array> {
  const ffmpeg = musicAudioTools().ffmpeg;
  if (!ffmpeg) throw new Error("export_unavailable");
  const dir = mkdtempSync(join(tmpdir(), "maipai-music-export-"));
  try {
    const input = join(dir, "in.m4a"), output = join(dir, `out.${format}`);
    writeFileSync(input, bytes);
    const codec = format === "wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "flac"];
    if (!(await run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", ...codec, output], dir))) throw new Error("export_failed");
    const made = new Uint8Array(readFileSync(output));
    if (made.length < 12) throw new Error("export_failed");
    return made;
  } catch (error) {
    if (error instanceof Error && error.message === "export_unavailable") throw error;
    throw new Error("export_failed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
