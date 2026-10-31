// VIDEOSHARE-01: sending a clip the way a phone does. The Web Share API takes the actual file, so Safari and Chrome open
// the system share sheet (Messages, AirDrop, Mail) with the video attached. The call must happen inside the click: the
// file is fetched ahead (when the card shows the clip) and `shareClip` starts `navigator.share` without awaiting
// anything first. A browser that cannot share files (most desktop Firefox and Chrome on Linux) gets the fallback:
// Home's own share page for the file.
import { requestJson } from "@/lib/api";

export interface ShareNavigator {
  canShare?: (data: { files?: File[]; title?: string }) => boolean;
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
}
export type ShareOutcome = "shared" | "cancelled" | "fallback";

export interface PreparedClip { blob: Blob; name: string }

/** The file name the server gave (Content-Disposition), or the fallback. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "");
  if (!match?.[1]) return fallback;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/** Fetches the file ahead of the click (a clip's messaging copy, or a song with `type: "audio/mp4"`). */
export async function prepareClip(url: string, signal?: AbortSignal, options: { type?: string; name?: string } = {}): Promise<PreparedClip> {
  const type = options.type ?? "video/mp4";
  const { blob, disposition } = await requestJson<{ blob: Blob; disposition: string | null }>(url, { ...(signal ? { signal } : {}) });
  return { blob: blob.type === type ? blob : new Blob([blob], { type }), name: fileNameFrom(disposition, options.name ?? "video.mp4") };
}

/** Call from the click handler. Synchronous up to `navigator.share`; the fallback runs when sharing a file is not possible or fails for a reason other than the person closing the sheet. */
export function shareClip(input: { prepared: PreparedClip | undefined; title: string; nav: ShareNavigator; fallback: () => void }): Promise<ShareOutcome> {
  const { prepared, title, nav, fallback } = input;
  if (prepared && typeof nav.share === "function" && typeof nav.canShare === "function") {
    const files = [new File([prepared.blob], prepared.name, { type: prepared.blob.type || "video/mp4" })];
    if (nav.canShare({ files })) {
      return nav.share({ files, title }).then(
        (): ShareOutcome => "shared",
        (error: unknown): ShareOutcome => {
          if (error instanceof Error && error.name === "AbortError") return "cancelled";
          fallback();
          return "fallback";
        },
      );
    }
  }
  fallback();
  return Promise.resolve("fallback");
}

/** Saves a blob under a name (the messaging copy), or a URL when the blob is not ready. */
export function saveClip(target: { blob?: Blob; url: string; name: string }): void {
  const link = document.createElement("a");
  const objectUrl = target.blob ? URL.createObjectURL(target.blob) : null;
  link.href = objectUrl ?? target.url;
  link.download = target.name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
