import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/queryClient";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createAudioSession, FADE_MS, type AudioSession, type VoiceSource } from "@/shell/audioSession";
import { AudioSessionProvider, useAudioRegistration, useAudioSessionState, useMiniBar } from "@/shell/audioSessionContext";
import { api } from "@/lib/api";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

/** A media element that behaves like the browser's for the parts the session reads. */
class FakeMedia extends EventTarget {
  paused = true;
  ended = false;
  private rate = 1;
  defaultPlaybackRate = 1;
  /** Like the browser, changing the rate fires `ratechange`. */
  get playbackRate() { return this.rate; }
  set playbackRate(value: number) { if (value === this.rate) return; this.rate = value; this.emit("ratechange"); }
  volume = 1;
  currentTime = 0;
  duration = 600;
  emit(type: string) { this.dispatchEvent(new Event(type)); }
  async play() { this.paused = false; this.emit("play"); }
  pause() { if (this.paused) return; this.paused = true; this.emit("pause"); }
  /** The person changes the rate in a player. */
  setRate(rate: number) { this.playbackRate = rate; }
}
const media = () => new FakeMedia();
const asEl = (m: FakeMedia) => m as unknown as HTMLMediaElement;

function fakeVoice() {
  const log = { paused: 0, volumes: [] as number[] };
  const source: VoiceSource = { pause: () => { log.paused++; }, setVolume: (v) => { log.volumes.push(v); } };
  return { source, log };
}

let session: AudioSession;
beforeEach(() => { session = createAudioSession(); });
afterEach(() => { cleanup(); jest.useRealTimers(); delete (navigator as unknown as { mediaSession?: unknown }).mediaSession; });

describe("one thing plays at a time", () => {
  test("two players cannot play at once: the second to play pauses the first", async () => {
    const a = media(); const b = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "Episode" } });
    session.registerElement(asEl(b), { kind: "music", item: { title: "Song" } });
    await a.play();
    expect(a.paused).toBe(false);
    await b.play();
    expect(b.paused).toBe(false);
    expect(a.paused).toBe(true);
    expect(session.getSnapshot().current?.item.title).toBe("Song");
    await a.play();
    expect(b.paused).toBe(true);
    expect(a.paused).toBe(false);
  });

  test("requestFocus before play pauses the other player", async () => {
    const a = media(); const b = media();
    session.registerElement(asEl(a), { kind: "video", item: { title: "Clip" } });
    const hb = session.registerElement(asEl(b), { kind: "audiobook", item: { title: "Book" } });
    await a.play();
    hb.requestFocus();
    expect(a.paused).toBe(true);
    expect(hb.focused).toBe(true);
  });

  test("starting a media item pauses chat voice, and chat voice starting pauses media", async () => {
    const a = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "Episode" } });
    const { source, log } = fakeVoice();
    const voice = session.registerVoice(source);
    voice.requestFocus();
    await a.play();
    expect(log.paused).toBe(1);
    const second = fakeVoice();
    session.registerVoice(second.source).requestFocus();
    expect(a.paused).toBe(true);
  });

  test("releasing the focused player clears the session", async () => {
    const a = media();
    const handle = session.registerElement(asEl(a), { kind: "music", item: { title: "Song" } });
    await a.play();
    expect(session.getSnapshot().current).not.toBeNull();
    handle.release();
    expect(session.getSnapshot().current).toBeNull();
    a.emit("play");
    expect(session.getSnapshot().current).toBeNull();
  });

  test("the mini bar state is null for chat voice and set for a media item", async () => {
    const { source } = fakeVoice();
    session.registerVoice(source).requestFocus();
    expect(session.getSnapshot().current?.kind).toBe("spoken_reply");
    expect(session.getSnapshot().miniBar).toBeNull();
    const a = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "Episode" }, next: () => {} });
    await a.play();
    const bar = session.getSnapshot().miniBar;
    expect(bar?.item.title).toBe("Episode");
    expect(bar?.playing).toBe(true);
    expect(bar?.hasNext).toBe(true);
    expect(bar?.hasPrevious).toBe(false);
  });

  test("controls pause, resume and seek the focused element", async () => {
    const a = media();
    session.registerElement(asEl(a), { kind: "audiobook", item: { title: "Book" } });
    await a.play();
    session.controls.pause();
    expect(a.paused).toBe(true);
    expect(session.getSnapshot().current?.playing).toBe(false);
    session.controls.toggle();
    await Promise.resolve();
    expect(a.paused).toBe(false);
    a.currentTime = 100;
    session.controls.seekBy(-15);
    expect(a.currentTime).toBe(85);
    session.controls.seekTo(9999);
    expect(a.currentTime).toBe(600);
  });
});

describe("playback speed per kind", () => {
  test("the saved speed is applied on register, per kind", () => {
    session.setSpeeds({ podcast: 1.5, audiobook: 1.25, video: 1.1 });
    const p = media(); const b = media(); const v = media(); const m = media();
    session.registerElement(asEl(p), { kind: "podcast", item: { title: "a" } });
    session.registerElement(asEl(b), { kind: "audiobook", item: { title: "b" } });
    session.registerElement(asEl(v), { kind: "video", item: { title: "c" } });
    session.registerElement(asEl(m), { kind: "music", item: { title: "d" } });
    expect([p.playbackRate, b.playbackRate, v.playbackRate, m.playbackRate]).toEqual([1.5, 1.25, 1.1, 1]);
    expect(p.defaultPlaybackRate).toBe(1.5);
  });

  test("spoken replies read their speed from the same map", () => {
    session.setSpeeds({ spoken_reply: 1.25 });
    expect(session.speedFor("spoken_reply")).toBe(1.25);
    expect(session.speedFor("music")).toBe(1);
  });

  test("a rate the person picks is written back once and reaches the other players of that kind", () => {
    const writes: Array<[string, number]> = [];
    session.setSpeedWriter((kind, rate) => writes.push([kind, rate]));
    session.setSpeeds({ podcast: 1.5 });
    const a = media(); const b = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "a" } });
    session.registerElement(asEl(b), { kind: "podcast", item: { title: "b" } });
    expect(writes).toEqual([]);
    a.setRate(2);
    expect(writes).toEqual([["podcast", 2]]);
    expect(b.playbackRate).toBe(2);
    expect(session.speedFor("podcast")).toBe(2);
  });

  test("applying the saved speed does not write it back", () => {
    const writes: unknown[] = [];
    session.setSpeedWriter((kind, rate) => writes.push([kind, rate]));
    const a = media();
    session.registerElement(asEl(a), { kind: "video", item: { title: "a" } });
    session.setSpeeds({ video: 1.75 });
    expect(a.playbackRate).toBe(1.75);
    expect(writes).toEqual([]);
  });

  test("a speed outside the allowed range is clamped", () => {
    session.setSpeeds({ podcast: 9 });
    const a = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "a" } });
    expect(a.playbackRate).toBe(3);
  });

  test("the controls' setRate saves for the focused kind", async () => {
    const writes: Array<[string, number]> = [];
    session.setSpeedWriter((kind, rate) => writes.push([kind, rate]));
    const a = media();
    session.registerElement(asEl(a), { kind: "audiobook", item: { title: "a" } });
    await a.play();
    session.controls.setRate(1.25);
    expect(a.playbackRate).toBe(1.25);
    expect(writes).toEqual([["audiobook", 1.25]]);
  });
});

describe("sleep timer", () => {
  test("pauses media after the chosen minutes, fading out first and restoring the volume", async () => {
    jest.useFakeTimers();
    const a = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "Episode" } });
    await a.play();
    session.startSleepTimer(15);
    expect(session.getSnapshot().sleep?.option).toBe(15);
    jest.advanceTimersByTime(15 * 60_000 - FADE_MS - 1000);
    expect(a.paused).toBe(false);
    expect(a.volume).toBe(1);
    jest.advanceTimersByTime(1000 + FADE_MS / 2 + 100);
    expect(a.paused).toBe(false);
    expect(a.volume).toBeLessThan(1);
    expect(a.volume).toBeGreaterThan(0);
    jest.advanceTimersByTime(FADE_MS);
    expect(a.paused).toBe(true);
    expect(a.volume).toBe(1);
    expect(session.getSnapshot().sleep).toBeNull();
  });

  test("pauses chat voice too", async () => {
    jest.useFakeTimers();
    const { source, log } = fakeVoice();
    session.registerVoice(source).requestFocus();
    session.startSleepTimer(30);
    jest.advanceTimersByTime(30 * 60_000 + 100);
    expect(log.paused).toBe(1);
    expect(log.volumes.length).toBeGreaterThan(3);
    expect(log.volumes.at(-1)).toBe(1);
  });

  test("each of 15, 30, 45 and 60 minutes pauses at its time", async () => {
    jest.useFakeTimers();
    for (const minutes of [15, 30, 45, 60] as const) {
      const s = createAudioSession();
      const a = media();
      s.registerElement(asEl(a), { kind: "video", item: { title: "v" } });
      await a.play();
      s.startSleepTimer(minutes);
      jest.advanceTimersByTime(minutes * 60_000 - 500);
      expect(a.paused).toBe(false);
      jest.advanceTimersByTime(1000);
      expect(a.paused).toBe(true);
    }
  });

  test("cancelling stops the timer", async () => {
    jest.useFakeTimers();
    const a = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "Episode" } });
    await a.play();
    session.startSleepTimer(15);
    session.cancelSleepTimer();
    jest.advanceTimersByTime(60 * 60_000);
    expect(a.paused).toBe(false);
    expect(session.getSnapshot().sleep).toBeNull();
  });

  test("end of chapter pauses at the end of the chapter playing now", async () => {
    const a = media();
    session.registerElement(asEl(a), { kind: "audiobook", item: { title: "Book", chapters: [{ start_s: 0, end_s: 60 }, { start_s: 60, end_s: 100 }] } });
    await a.play();
    a.currentTime = 70;
    session.startSleepTimer("end_of_item");
    a.emit("timeupdate");
    expect(a.paused).toBe(false);
    jest.useFakeTimers();
    a.currentTime = 99;
    a.emit("timeupdate");
    expect(a.paused).toBe(false); // fading
    a.currentTime = 99.9;
    a.emit("timeupdate");
    expect(a.paused).toBe(true);
    expect(a.volume).toBe(1);
    expect(session.getSnapshot().sleep).toBeNull();
  });

  test("end of episode without chapters lets the item end and holds the next one", async () => {
    const a = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "Episode" } });
    await a.play();
    session.startSleepTimer("end_of_item");
    a.ended = true;
    a.emit("ended");
    expect(session.getSnapshot().sleep).toBeNull();
    expect(session.getSnapshot().sleepHold).toBe(true);
    await a.play();
    expect(session.getSnapshot().sleepHold).toBe(false);
  });
});

describe("Media Session", () => {
  function installFakeMediaSession() {
    const calls: Record<string, number> = {};
    const handlers: Record<string, MediaSessionActionHandler | null> = {};
    const fake = {
      metadata: null as unknown,
      playbackState: "none",
      setActionHandler: (action: string, handler: MediaSessionActionHandler | null) => { calls[action] = (calls[action] ?? 0) + 1; handlers[action] = handler; },
      setPositionState: () => {},
    };
    Object.defineProperty(navigator, "mediaSession", { value: fake, configurable: true });
    (globalThis as unknown as { MediaMetadata: unknown }).MediaMetadata = class { constructor(public init: Record<string, unknown>) {} };
    return { fake, calls, handlers };
  }

  test("handlers are set once however many players register, and metadata follows the focused item", async () => {
    const { fake, calls } = installFakeMediaSession();
    const a = media(); const b = media();
    session.registerElement(asEl(a), { kind: "podcast", item: { title: "Episode", artist: "Show" } });
    session.registerElement(asEl(b), { kind: "music", item: { title: "Song", album: "Album" } });
    await a.play();
    await b.play();
    await a.play();
    for (const action of ["play", "pause", "stop", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"]) expect(calls[action]).toBe(1);
    expect((fake.metadata as { init: { title: string } }).init.title).toBe("Episode");
    expect(fake.playbackState).toBe("playing");
    a.pause();
    expect(fake.playbackState).toBe("paused");
  });

  test("the handlers drive the focused player", async () => {
    const { handlers } = installFakeMediaSession();
    const a = media();
    session.registerElement(asEl(a), { kind: "audiobook", item: { title: "Book" } });
    await a.play();
    handlers["pause"]?.({ action: "pause" });
    expect(a.paused).toBe(true);
    a.currentTime = 100;
    handlers["seekforward"]?.({ action: "seekforward" });
    expect(a.currentTime).toBe(130);
    handlers["seekbackward"]?.({ action: "seekbackward", seekOffset: 10 });
    expect(a.currentTime).toBe(120);
  });

  test("a session with no Media Session in the browser still works", async () => {
    const a = media();
    session.registerElement(asEl(a), { kind: "music", item: { title: "Song" } });
    await a.play();
    expect(session.getSnapshot().current?.playing).toBe(true);
  });
});

describe("React", () => {
  const wrapperFor = (client: QueryClient) => ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><AudioSessionProvider personId="p1" session={session}>{children}</AudioSessionProvider></QueryClientProvider>
  );

  test("the provider applies the person's saved speeds", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([{ key: "audio.speed.podcast", value: 1.5 }] as never);
    renderWithQueryClient(<AudioSessionProvider personId="p1" session={session}><span /></AudioSessionProvider>);
    await waitFor(() => expect(session.speedFor("podcast")).toBe(1.5));
    values.mockRestore();
  });

  test("useAudioRegistration registers on mount, releases on unmount, and useMiniBar follows", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const a = media();
    const { result, unmount } = renderHook(() => {
      useAudioRegistration(asEl(a), { kind: "podcast", item: { title: "Episode" } });
      return useMiniBar();
    }, { wrapper: wrapperFor(createQueryClient()) });
    expect(result.current.state).toBeNull();
    await act(async () => { await a.play(); });
    expect(result.current.state?.item.title).toBe("Episode");
    unmount();
    expect(session.getSnapshot().current).toBeNull();
    values.mockRestore();
  });

  test("the provider saves a chosen rate through the settings API for the signed-in person", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const set = spyOn(api, "setSetting").mockResolvedValue(undefined as never);
    renderWithQueryClient(<AudioSessionProvider personId="p1" session={session}><span /></AudioSessionProvider>);
    await waitFor(() => expect(values).toHaveBeenCalled());
    const a = media();
    session.registerElement(asEl(a), { kind: "audiobook", item: { title: "Book" } });
    a.setRate(1.25);
    expect(set).toHaveBeenCalledWith("person:p1", "audio.speed.audiobook", 1.25);
    values.mockRestore();
    set.mockRestore();
  });

  test("useAudioSessionState rerenders on play state", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const a = media();
    session.registerElement(asEl(a), { kind: "music", item: { title: "Song" } });
    const { result } = renderHook(() => useAudioSessionState(), { wrapper: wrapperFor(createQueryClient()) });
    expect(result.current.current).toBeNull();
    await act(async () => { await a.play(); });
    expect(result.current.current?.playing).toBe(true);
    values.mockRestore();
  });
});
