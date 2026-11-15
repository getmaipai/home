import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { LYRIC_FOLLOW_RESUME_MS, useLyricsFollow } from "./useLyricsFollow";

afterEach(cleanup);

describe("expanded Music lyrics follow", () => {
  test("pauses on a person's scroll, resumes after three idle seconds, and seeks a clicked timed line", () => {
    const savedSetTimeout = window.setTimeout;
    const savedClearTimeout = window.clearTimeout;
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let nextTimer = 0;
    window.setTimeout = ((callback: TimerHandler, delay?: number) => {
      const id = ++nextTimer;
      if (typeof callback === "function") timers.set(id, { callback: callback as () => void, delay: delay ?? 0 });
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof window.clearTimeout;
    try {
      const root = document.createElement("div");
      root.innerHTML = '<div data-slot="lyrics-list"><button data-line-index="0">first</button><button data-line-index="1">second</button></div>';
      const list = root.querySelector<HTMLElement>("[data-slot=lyrics-list]")!;
      list.scrollTo = () => {};
      const seek = (seconds: number) => seeks.push(seconds);
      const seeks: number[] = [];
      const lines = [{ t: 0, line: "first" }, { t: 8, line: "second" }];
      const { result } = renderHook(() => useLyricsFollow(root, lines, 1, seek));
      expect(result.current.following).toBe(true);

      act(() => list.dispatchEvent(new Event("wheel")));
      expect(result.current.following).toBe(false);
      expect(LYRIC_FOLLOW_RESUME_MS).toBe(3_000);
      const idleResume = [...timers.values()].find((timer) => timer.delay === LYRIC_FOLLOW_RESUME_MS);
      expect(idleResume).toBeDefined();
      act(() => idleResume?.callback());
      expect(result.current.following).toBe(true);

      act(() => list.querySelector<HTMLElement>('[data-line-index="1"]')!.click());
      expect(seeks).toEqual([8]);
      expect(result.current.following).toBe(true);
    } finally {
      window.setTimeout = savedSetTimeout;
      window.clearTimeout = savedClearTimeout;
    }
  });
});
