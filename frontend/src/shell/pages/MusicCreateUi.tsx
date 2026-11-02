// MUSIC-WORKSPACE-03: the picture parts of the Music Create home, in the look of a modern creator app: covers that are never empty (a real cover when the
// song has one, otherwise a gradient drawn from the song's id and its title in big type), media tiles that lift on hover with a play button and glass
// pills, a shimmer while a song is being made, carousels with arrows, and the floating glass prompt bar. Colors are the kit's hue tokens through
// custom properties, so nothing here carries a raw color. These are plain parts built from tokens, not wrappers around a kit Element.
import { useRef, type CSSProperties, type ReactNode } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";

const HUES = ["--hue-violet", "--hue-teal", "--hue-orange", "--hue-pink", "--hue-red", "--hue-green"];
const PlayIcon = getIcon("play");
const LeftIcon = getIcon("chevron-left");
const RightIcon = getIcon("chevron-right");

/** A number from text, the same every time: it picks a cover's colors and where the light falls. */
export function seedOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/** The custom properties of a generated cover: three hues and where each one's light falls. The same id always gives the same cover. */
export function coverVars(seed: string): Record<string, string> {
  const n = seedOf(seed);
  const first = n % HUES.length;
  const pick = (offset: number): string => `var(${HUES[(first + offset) % HUES.length]})`;
  const at = (shift: number): string => `${10 + ((n >>> shift) % 80)}%`;
  return { "--c1": pick(0), "--c2": pick(2 + (n % 2)), "--c3": pick(4), "--x1": at(0), "--y1": at(4), "--x2": at(8), "--y2": at(12), "--x3": at(16), "--y3": at(20) };
}

/** A cover that fills its box. A real picture when there is one; otherwise three soft blurred lights from the song's id with the title in big type. */
export function Cover({ id, title, url, big = false, bare = false }: { id: string; title: string; url: string | null; big?: boolean; bare?: boolean }) {
  if (url) return <img src={url} alt="" className="size-full object-cover" />;
  const v = coverVars(id);
  const light = "absolute size-4/5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-80 blur-3xl";
  return <div aria-hidden="true" className="bg-background relative flex size-full items-end overflow-hidden p-4" style={{ "--c1": v["--c1"], "--c2": v["--c2"], "--c3": v["--c3"], "--x1": v["--x1"], "--y1": v["--y1"], "--x2": v["--x2"], "--y2": v["--y2"], "--x3": v["--x3"], "--y3": v["--y3"] } as CSSProperties}>
    <span className={`${light} bg-(--c1) top-(--y1) left-(--x1)`} /><span className={`${light} bg-(--c2) top-(--y2) left-(--x2)`} /><span className={`${light} bg-(--c3) top-(--y3) left-(--x3)`} />
    {bare ? null : <span className={`relative line-clamp-4 font-black tracking-tight uppercase drop-shadow-lg ${big ? "text-4xl leading-none sm:text-5xl" : "text-xl leading-none sm:text-2xl"}`}>{title}</span>}
  </div>;
}

/** The moving light over a tile while its song is being made. Held still for people who ask for less motion. */
export function Shimmer() {
  return <span aria-hidden="true" className="from-foreground/0 via-foreground/15 to-foreground/0 motion-safe:animate-pulse absolute inset-0 bg-linear-to-br" />;
}

/** A small label on a cover: a play count, a length, a state. Dark glass so it reads on any picture. */
export function GlassPill({ children }: { children: ReactNode }) {
  return <span className="bg-background/50 text-foreground rounded-full px-2.5 py-1 text-xs font-medium tabular-nums backdrop-blur-md">{children}</span>;
}

/** One tall tile: the cover fills it, a play button and a lift on hover, glass pills on the corners, the title and its line under it. */
export function MediaTile({ id, title, line, coverUrl, selected = false, busy = false, playable = false, pills, progress, verb = "Open", onOpen, children }: {
  verb?: string; id: string; title: string; line?: string; coverUrl: string | null; selected?: boolean; busy?: boolean; playable?: boolean; pills?: ReactNode; progress?: number; onOpen: () => void; children?: ReactNode;
}) {
  return <li className="group flex w-44 shrink-0 snap-start flex-col gap-2 sm:w-52" data-testid="music-song-tile">
    <button type="button" onClick={onOpen} aria-label={`${verb} ${title}`} aria-current={selected ? "true" : undefined}
      className={`relative block aspect-3/4 w-full overflow-hidden rounded-2xl transition duration-200 motion-safe:group-hover:-translate-y-1 motion-safe:group-focus-within:-translate-y-1 ${selected ? "ring-(--accent-lime) ring-2" : ""}`}>
      <Cover id={id} title={title} url={coverUrl} />
      {busy ? <Shimmer /> : null}
      <span className="from-background/70 absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t to-transparent" aria-hidden="true" />
      {pills ? <span className="absolute top-2 left-2 flex gap-1">{pills}</span> : null}
      {playable ? <span className="bg-(--accent-lime) text-background absolute right-3 bottom-3 flex size-11 items-center justify-center rounded-full opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"><PlayIcon className="size-5" aria-hidden="true" /></span> : null}
      {progress !== undefined ? <span className="bg-background/60 absolute inset-x-0 bottom-0 h-1.5"><span className="bg-(--accent-lime) block h-full w-(--song-progress)" style={{ "--song-progress": `${Math.max(6, Math.round(progress * 100))}%` } as CSSProperties} /></span> : null}
    </button>
    <div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p>{line ? <p className="text-muted-foreground truncate text-xs">{line}</p> : null}</div>
    {children}
  </li>;
}

/** A horizontal row that snaps tile to tile, with arrows to move it a screen at a time. */
export function Carousel({ title, line, children, label }: { title: string; line?: string; children: ReactNode; label: string }) {
  const track = useRef<HTMLUListElement>(null);
  const move = (direction: 1 | -1) => track.current?.scrollBy({ left: direction * Math.max(240, track.current.clientWidth * 0.8), behavior: "smooth" });
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-1"><h2 className="text-2xl font-black tracking-wide uppercase">{title}</h2>{line ? <p className="text-muted-foreground text-sm">{line}</p> : null}</div>
      <div className="hidden gap-2 sm:flex">
        <Button type="button" variant="secondary" size="icon" aria-label={`Earlier in ${label}`} onClick={() => move(-1)}><LeftIcon className="size-4" aria-hidden="true" /></Button>
        <Button type="button" variant="secondary" size="icon" aria-label={`Later in ${label}`} onClick={() => move(1)}><RightIcon className="size-4" aria-hidden="true" /></Button>
      </div>
    </div>
    <ul ref={track} aria-label={label} className="-mx-4 flex snap-x list-none gap-4 overflow-x-auto scroll-smooth px-4 pb-2 lg:-mx-6 lg:px-6">{children}</ul>
  </div>;
}
