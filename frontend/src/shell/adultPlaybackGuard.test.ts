// ADULT-LOCK-05 (design note 3.9 item 3, test 9): no leak around playback of an unlocked adult-only clip.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { adultBlobUrl, revokeAdultBlobs, setAdultProof } from "@/lib/adultLock";
import { ADULT_CONTROLS_LIST, installAdultPlaybackGuard } from "@/shell/adultPlaybackGuard";

const originalFetch = globalThis.fetch;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let blobUrl = "";
let uninstall: (() => void) | null = null;
const session = { metadata: null as unknown } as { metadata: unknown; playbackState?: string };

beforeEach(async () => {
  URL.createObjectURL = (() => "blob:guard/1") as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  globalThis.fetch = mock(() => Promise.resolve(new Response("bytes"))) as unknown as typeof fetch;
  setAdultProof("p"); revokeAdultBlobs();
  blobUrl = (await adultBlobUrl("/api/files/a/content"))!;
  session.metadata = null;
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
});
afterEach(() => {
  uninstall?.(); uninstall = null;
  globalThis.fetch = originalFetch; URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
  setAdultProof(null); revokeAdultBlobs();
  document.body.innerHTML = "";
});

const video = (src: string) => { const el = document.createElement("video"); el.setAttribute("src", src); document.body.append(el); return el; };
const fire = (el: HTMLElement, name: string) => el.dispatchEvent(new Event(name, { bubbles: false }));

describe("the playback guard", () => {
  test("a clip playing from one of our blob URLs gets no Picture in Picture, remote playback, AirPlay, download or loop", () => {
    const el = video(blobUrl); el.setAttribute("loop", "");
    uninstall = installAdultPlaybackGuard();
    expect((el as HTMLVideoElement).disablePictureInPicture).toBe(true);
    expect((el as unknown as { disableRemotePlayback: boolean }).disableRemotePlayback).toBe(true);
    expect(el.getAttribute("controlsList")).toBe(ADULT_CONTROLS_LIST);
    expect(el.getAttribute("x-webkit-airplay")).toBe("deny");
    expect(el.hasAttribute("loop")).toBe(false);
  });

  test("an element loaded after the guard is hardened when it starts loading; a clip from any other address is left alone", () => {
    uninstall = installAdultPlaybackGuard();
    const ours = video(blobUrl);
    const plain = video("/api/files/z/content");
    fire(ours, "loadstart"); fire(plain, "loadstart");
    expect(ours.getAttribute("controlsList")).toBe(ADULT_CONTROLS_LIST);
    expect(plain.hasAttribute("controlsList")).toBe(false);
  });

  test("while it plays the Media Session holds no title or artwork, even when the player sets one; when it stops the session is the page's again", () => {
    const el = video(blobUrl);
    uninstall = installAdultPlaybackGuard();
    fire(el, "play");
    session.metadata = { title: "Zebraquill", artwork: [{ src: "/x.jpg" }] };
    expect(session.metadata).toBeNull();
    fire(el, "pause");
    session.metadata = { title: "Something else" };
    expect(session.metadata).toEqual({ title: "Something else" });
  });

  test("a plain clip playing never blocks the Media Session", () => {
    const plain = video("/api/files/z/content");
    uninstall = installAdultPlaybackGuard();
    fire(plain, "play");
    session.metadata = { title: "Open clip" };
    expect(session.metadata).toEqual({ title: "Open clip" });
  });

  test("removing the guard (relock) gives the Media Session back", () => {
    const el = video(blobUrl);
    uninstall = installAdultPlaybackGuard();
    fire(el, "play");
    uninstall(); uninstall = null;
    session.metadata = { title: "after" };
    expect(session.metadata).toEqual({ title: "after" });
  });
});

test("what the Media Session held before (another item's) is put back when the clip stops", () => {
  const song = { title: "A song" };
  session.metadata = song;
  const el = video(blobUrl);
  uninstall = installAdultPlaybackGuard();
  fire(el, "play");
  expect(session.metadata).toBeNull();
  fire(el, "pause");
  expect(session.metadata).toBe(song);
});
