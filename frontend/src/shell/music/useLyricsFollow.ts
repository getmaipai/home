// SF-08d: follows the active lyric line in the expanded view. It uses the kit Player's lyrics as shipped and adds only what the kit
// lacks on the host side: the 20 percent rule, pausing on the person's own scroll and a click on a line to seek. It finds the kit's list
// by its data-slot inside `root`; where the list or its line markers are not there it does nothing.
import { useEffect, useRef, useState } from "react";
import type { TimedLyricLine } from "@maipai/ui/src/elements/lyrics-list";
import { activeLineIndex, followScrollTop, nextFollow } from "./musicBarMath";

export const LYRIC_FOLLOW_RESUME_MS = 3_000;
const timers = {
  setTimeout: (callback: () => void, delay: number) => window.setTimeout(callback, delay),
  clearTimeout: (timer: number) => window.clearTimeout(timer),
};

export function useLyricsFollow(root: HTMLElement | null, lines: readonly TimedLyricLine[] | undefined, time: number, seek: (seconds: number) => void): { following: boolean; resume: () => void } {
  const following = useRef(true);
  const [isFollowing, setIsFollowing] = useState(true);
  const idleTimer = useRef<number | null>(null);
  const lastShown = useRef(-2);
  const programmatic = useRef(false);
  const programmaticTimer = useRef<number | null>(null);
  const index = lines?.length ? activeLineIndex(lines, time) : -1;

  useEffect(() => {
    if (!root || !lines?.length) return;
    const list = root.querySelector<HTMLElement>('[data-slot="lyrics-list"]');
    if (!list) return;
    const user = (explicit = false) => {
      if (programmatic.current && !explicit) return;
      if (explicit) {
        programmatic.current = false;
        if (programmaticTimer.current !== null) { timers.clearTimeout(programmaticTimer.current); programmaticTimer.current = null; }
      }
      following.current = nextFollow(following.current, "user-scroll");
      setIsFollowing(false);
      if (idleTimer.current !== null) timers.clearTimeout(idleTimer.current);
      idleTimer.current = timers.setTimeout(() => {
        idleTimer.current = null;
        following.current = nextFollow(following.current, "resume");
        setIsFollowing(true);
        lastShown.current = -2;
      }, LYRIC_FOLLOW_RESUME_MS);
    };
    const click = (event: Event) => {
      const row = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-line-index]");
      const at = row ? Number(row.dataset.lineIndex) : NaN;
      const line = Number.isInteger(at) ? lines[at] : undefined;
      if (!line) return;
      following.current = nextFollow(following.current, "line-click");
      setIsFollowing(true);
      if (idleTimer.current !== null) { timers.clearTimeout(idleTimer.current); idleTimer.current = null; }
      if (programmaticTimer.current !== null) { timers.clearTimeout(programmaticTimer.current); programmaticTimer.current = null; programmatic.current = false; }
      lastShown.current = -2;
      seek(line.t);
    };
    const scroll = () => user();
    const explicitUser = () => user(true);
    list.addEventListener("scroll", scroll, { passive: true });
    list.addEventListener("wheel", explicitUser, { passive: true });
    list.addEventListener("touchmove", explicitUser, { passive: true });
    list.addEventListener("pointerdown", explicitUser, { passive: true });
    list.addEventListener("click", click);
    return () => {
      list.removeEventListener("scroll", scroll);
      list.removeEventListener("wheel", explicitUser);
      list.removeEventListener("touchmove", explicitUser);
      list.removeEventListener("pointerdown", explicitUser);
      list.removeEventListener("click", click);
      if (idleTimer.current !== null) { timers.clearTimeout(idleTimer.current); idleTimer.current = null; }
      if (programmaticTimer.current !== null) { timers.clearTimeout(programmaticTimer.current); programmaticTimer.current = null; programmatic.current = false; }
    };
  }, [root, lines, seek]);

  useEffect(() => {
    if (!root || !following.current || index === lastShown.current) return;
    const list = root.querySelector<HTMLElement>('[data-slot="lyrics-list"]');
    const row = list?.querySelector<HTMLElement>(`[data-line-index="${Math.max(0, index)}"]`);
    if (!list || !row) return;
    lastShown.current = index;
    programmatic.current = true;
    list.scrollTo({ top: index < 0 ? 0 : followScrollTop(row.offsetTop, row.offsetHeight, list.clientHeight), behavior: "smooth" });
    if (programmaticTimer.current !== null) timers.clearTimeout(programmaticTimer.current);
    programmaticTimer.current = timers.setTimeout(() => { programmatic.current = false; programmaticTimer.current = null; }, 600);
  }, [root, index, isFollowing]);

  const resume = () => {
    following.current = nextFollow(following.current, "resume");
    setIsFollowing(true);
    if (idleTimer.current !== null) { timers.clearTimeout(idleTimer.current); idleTimer.current = null; }
    if (programmaticTimer.current !== null) { timers.clearTimeout(programmaticTimer.current); programmaticTimer.current = null; programmatic.current = false; }
    lastShown.current = -2;
  };
  return { following: isFollowing, resume };
}
