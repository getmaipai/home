// The one AudioContext spoken replies play through.
//
// iOS Safari starts every AudioContext suspended and only lets one start from a tap. A live voice reply is begun by a
// transcript arriving on a socket, not by a tap, so a context created for that reply stayed suspended and the reply
// never made a sound (seen on a phone, 2026-10-25: replies stored in full, none heard). One context is made and resumed
// inside the person's first touch, key press or click, and every reply reuses it.
let shared: AudioContext | null = null;
let installed = false;

type AudioContextCtor = typeof AudioContext;

function contextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;
}

/** The shared context, made on first use and again if the browser closed it. Throws when the browser has no Web Audio. */
export function sharedPlaybackContext(): AudioContext {
  if (shared && shared.state !== "closed") return shared;
  const Ctor = contextCtor();
  if (!Ctor) throw new DOMException("AudioContext is not available in this browser", "NotSupportedError");
  shared = new Ctor();
  return shared;
}

/** Call from inside a tap, key press or click: makes the context if needed, resumes it and plays one silent sample, which is
 * what WebKit counts as unlocking audio. Safe to call any number of times. */
export function primePlaybackAudio(): void {
  try {
    const context = sharedPlaybackContext();
    void context.resume().catch(() => {});
    if (typeof context.createBuffer === "function" && typeof context.createBufferSource === "function") {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, 22_050);
      source.connect(context.destination);
      source.start(0);
    }
  } catch {
    /* no Web Audio: replies are text only, and the speech path reports it at its own step */
  }
}

/** Unlocks playback on the person's first gesture, and again on any later one while the context is not running (the phone
 * locked, a call came in, the tab slept). */
export function installPlaybackUnlock(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const unlock = () => {
    if (shared && shared.state === "running") return;
    primePlaybackAudio();
  };
  for (const type of ["pointerdown", "touchend", "keydown", "click"]) document.addEventListener(type, unlock, { capture: true, passive: true });
}

/** Test seam: forget the shared context. */
export function __resetPlaybackContextForTests(): void {
  shared = null;
}
