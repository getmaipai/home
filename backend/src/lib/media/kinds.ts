// MEDIA-LIB-01: which file extensions are media, and the media type each is served with.
export const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/x-m4v", mkv: "video/x-matroska", mov: "video/quicktime", avi: "video/x-msvideo", webm: "video/webm",
  mpg: "video/mpeg", mpeg: "video/mpeg", ts: "video/mp2t", wmv: "video/x-ms-wmv", flv: "video/x-flv", ogv: "video/ogg", "3gp": "video/3gpp",
};
export const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", m4b: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  wav: "audio/wav", wma: "audio/x-ms-wma", aiff: "audio/aiff", aif: "audio/aiff",
};
export const BOOK_TYPES: Record<string, string> = { epub: "application/epub+zip", pdf: "application/pdf" };
export const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export type FileClass = "video" | "audio" | "book" | "image" | "other";

export function classOfExtension(ext: string): FileClass {
  if (ext in VIDEO_TYPES) return "video";
  if (ext in AUDIO_TYPES) return "audio";
  if (ext in BOOK_TYPES) return "book";
  if (ext in IMAGE_TYPES) return "image";
  return "other";
}

export function mediaTypeOfExtension(ext: string): string {
  return VIDEO_TYPES[ext] ?? AUDIO_TYPES[ext] ?? BOOK_TYPES[ext] ?? IMAGE_TYPES[ext] ?? "application/octet-stream";
}

/** What a browser plays straight from the file, by container and codecs. The Stack's probe supplies the codecs; a tag reader
 * supplies an audio file's. Anything else needs a transcode (`transcode`), a file with no stream at all is `none`. */
const DIRECT_CONTAINERS = new Set(["mp4", "m4v", "mov", "webm", "ogv"]);
const DIRECT_VIDEO = new Set(["h264", "avc1", "hvc1", "vp8", "vp9", "av1", "av01"]);
const DIRECT_AUDIO = new Set(["aac", "mp3", "mp4a", "opus", "vorbis", "flac", "alac", "pcm_s16le"]);

export function decidePlayable(input: { ext: string; hasVideo: boolean; hasAudio: boolean; videoCodec: string | null; audioCodec: string | null }): "original" | "transcode" | "none" {
  if (!input.hasVideo && !input.hasAudio) return "none";
  const audioOk = !input.hasAudio || input.audioCodec === null || DIRECT_AUDIO.has(input.audioCodec.toLowerCase());
  if (!input.hasVideo) return audioOk ? "original" : "transcode";
  const videoOk = input.videoCodec !== null && DIRECT_VIDEO.has(input.videoCodec.toLowerCase());
  return DIRECT_CONTAINERS.has(input.ext) && videoOk && audioOk ? "original" : "transcode";
}

/** Audio a browser plays from the file with no probe: judged by extension, since a tag reader already named the codec. */
export function audioPlayableByExtension(ext: string): "original" | "unknown" {
  return ["mp3", "m4a", "m4b", "aac", "flac", "ogg", "oga", "opus", "wav"].includes(ext) ? "original" : "unknown";
}
