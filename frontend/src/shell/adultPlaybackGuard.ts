// ADULT-LOCK-05: no leak around playback of an unlocked adult-only clip (design note section 3.9, item 3). The clip plays in the page's own element
// from a Blob URL (lib/adultLock.ts). The kit's Player sets Media Session metadata (title, artwork) for anything it plays and the browser offers
// Picture in Picture, remote playback and AirPlay on any `<video>`; this guard switches all of that off for exactly the elements whose source is one of
// our object URLs, while the page is unlocked. It is installed by AdultLockHost and removed on relock.
import { isAdultBlobUrl, trackAdultElement } from "@/lib/adultLock";

export const ADULT_CONTROLS_LIST = "nodownload noremoteplayback";

type SessionHolder = { mediaSession?: MediaSession };

const isAdultElement = (value: EventTarget | null): value is HTMLMediaElement =>
  typeof HTMLMediaElement !== "undefined" && value instanceof HTMLMediaElement && (isAdultBlobUrl(value.currentSrc) || isAdultBlobUrl(value.getAttribute("src")));

/** Switch off every way an element can be handed to another surface. */
export function hardenAdultElement(el: HTMLMediaElement, doc: Document = document): void {
  trackAdultElement(el);
  (el as HTMLVideoElement).disablePictureInPicture = true;
  (el as HTMLMediaElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
  el.setAttribute("controlsList", ADULT_CONTROLS_LIST);
  el.setAttribute("x-webkit-airplay", "deny");
  el.removeAttribute("loop");
  const pip = (doc as Document & { pictureInPictureElement?: Element | null }).pictureInPictureElement;
  if (pip === el) void (doc as Document & { exitPictureInPicture?: () => Promise<void> }).exitPictureInPicture?.().catch(() => undefined);
}

/** While active, the page's Media Session never holds a title or artwork: `metadata` reads null and ignores a set. What it held before (another item's) is put back after. */
function blockMediaSession(nav: SessionHolder): () => void {
  const session = nav.mediaSession;
  if (!session) return () => undefined;
  const previous = session.metadata;
  try { session.metadata = null; } catch { /* a browser without metadata support */ }
  try { Object.defineProperty(session, "metadata", { configurable: true, get: () => null, set: () => undefined }); } catch { return () => undefined; }
  return () => {
    try { delete (session as unknown as Record<string, unknown>).metadata; } catch { /* nothing to restore */ }
    try { session.metadata = previous; } catch { /* a browser without metadata support */ }
  };
}

export function installAdultPlaybackGuard(doc: Document = document, nav: SessionHolder = typeof navigator === "undefined" ? {} : navigator): () => void {
  let unblock: (() => void) | null = null;
  const playing = new Set<HTMLMediaElement>();
  const harden = (event: Event) => { if (isAdultElement(event.target)) hardenAdultElement(event.target, doc); };
  const start = (event: Event) => {
    if (!isAdultElement(event.target)) return;
    hardenAdultElement(event.target, doc);
    playing.add(event.target);
    unblock ??= blockMediaSession(nav);
  };
  const stop = (event: Event) => {
    if (!(event.target instanceof HTMLMediaElement) || !playing.delete(event.target)) return;
    if (playing.size === 0) { unblock?.(); unblock = null; }
  };
  const harden1 = ["loadstart", "loadedmetadata", "canplay"];
  const begin = ["play", "playing"];
  const end = ["pause", "ended", "emptied", "abort"];
  for (const name of harden1) doc.addEventListener(name, harden, true);
  for (const name of begin) doc.addEventListener(name, start, true);
  for (const name of end) doc.addEventListener(name, stop, true);
  // An element already loaded when the guard goes in (the page unlocked while it was on screen).
  doc.querySelectorAll<HTMLMediaElement>("video,audio").forEach((el) => { if (isAdultElement(el)) hardenAdultElement(el, doc); });
  return () => {
    for (const name of harden1) doc.removeEventListener(name, harden, true);
    for (const name of begin) doc.removeEventListener(name, start, true);
    for (const name of end) doc.removeEventListener(name, stop, true);
    playing.clear();
    unblock?.();
    unblock = null;
  };
}
