// SF-08d: follows the active lyric line in the expanded view. It uses the kit Player's lyrics as shipped and adds only what the kit
// lacks on the host side: the 20 percent rule, pausing on the person's own scroll and a click on a line to seek. It finds the kit's list
// by its data-slot inside `root`; where the list or its line markers are not there it does nothing.
import { useEffect, useRef } from "react";
import type { TimedLyricLine } from "@maipai/ui/src/elements/lyrics-list";
import { activeLineIndex, followScrollTop, nextFollow } from "./musicBarMath";

export function useLyricsFollow(root: HTMLElement | null, lines: readonly TimedLyricLine[] | undefined, time: number, seek: (seconds: number) => void): void {
  const following = useRef(true);
  const lastShown = useRef(-2);
  const programmatic = useRef(false);
  const index = lines?.length ? activeLineIndex(lines, time) : -1;

  useEffect(() => {
    if (!root || !lines?.length) return;
    const list = root.querySelector<HTMLElement>('[data-slot="lyrics-list"]');
    if (!list) return;
    const user = () => { if (!programmatic.current) following.current = nextFollow(following.current, "user-scroll"); };
    const click = (event: Event) => {
      const row = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-line-index]");
      const at = row ? Number(row.dataset.lineIndex) : NaN;
      const line = Number.isInteger(at) ? lines[at] : undefined;
      if (!line) return;
      following.current = nextFollow(following.current, "line-click");
      lastShown.current = -2;
      seek(line.t);
    };
    list.addEventListener("wheel", user, { passive: true });
    list.addEventListener("touchmove", user, { passive: true });
    list.addEventListener("click", click);
    return () => { list.removeEventListener("wheel", user); list.removeEventListener("touchmove", user); list.removeEventListener("click", click); };
  }, [root, lines, seek]);

  useEffect(() => {
    if (!root || !following.current || index === lastShown.current) return;
    const list = root.querySelector<HTMLElement>('[data-slot="lyrics-list"]');
    const row = list?.querySelector<HTMLElement>(`[data-line-index="${Math.max(0, index)}"]`);
    if (!list || !row) return;
    lastShown.current = index;
    programmatic.current = true;
    list.scrollTo({ top: index < 0 ? 0 : followScrollTop(row.offsetTop, row.offsetHeight, list.clientHeight), behavior: "smooth" });
    window.setTimeout(() => { programmatic.current = false; }, 600);
  }, [root, index]);
}
