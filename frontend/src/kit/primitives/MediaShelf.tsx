import type { ReactNode } from "react";
import { Card } from "@/kit/components/Card";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { Section } from "@/kit/primitives/Section";
import { SHELF_ITEM_WIDTH, type Density } from "@/kit/responsive";
import { cn, FOCUS_RING } from "@/kit/utils";

/** The aspect ratios the kit will draw a media tile at. A closed set,
 * not a free string: docs/UI.md requires images and video to be fluid
 * "with declared aspect ratios", and a declared ratio is only useful if
 * every shelf in the product draws from the same short list. */
export type MediaAspect = "wide" | "square" | "poster";

const ASPECT_CLASSES: Record<MediaAspect, string> = {
  wide: "aspect-video",
  square: "aspect-square",
  poster: "aspect-[2/3]",
};

interface MediaShelfProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  /** The media itself (an image, a poster, a video still). The shelf
   * gives it a fluid box at the declared aspect ratio; the caller fills
   * that box and never sets a width or a height. */
  renderItem: (item: T) => ReactNode;
  /** Optional text under the tile, outside the aspect box, so a title
   * that wraps to two lines cannot crop the artwork. */
  renderCaption?: (item: T) => ReactNode;
  aspect?: MediaAspect;
  onSelect?: (item: T) => void;
  getLabel?: (item: T) => string;
  isSelected?: (item: T) => boolean;
  density?: Density;
  heading?: string;
  /** Accessible name for the rail. Falls back to `heading`. */
  label?: string;
  emptyState?: { icon: string; text: string };
}

// docs/UI.md names MediaShelf as a kit primitive, and docs/BACKLOG.md
// names the failure it exists to prevent: legacy shipped separate
// VideosRail, MusicRail, PodcastRail and NewsLayout components for what
// should be one shared component. This is that one component - a
// horizontally scrolling rail of media tiles, content-agnostic, sized by
// the kit's density budget (@/kit/responsive) rather than by its caller.
//
// Not built here: TV. docs/UI.md's TV surface is a focusable rail with
// no hover, keyed off input mode, and nothing in the shell detects an
// input mode yet. The tiles are real buttons, so they already focus and
// scroll into view with a keyboard or a remote's directional pad; the
// TV-specific presentation waits for the surface to exist.
export function MediaShelf<T>({
  items,
  getKey,
  renderItem,
  renderCaption,
  aspect = "wide",
  onSelect,
  getLabel,
  isSelected,
  density = "default",
  heading,
  label,
  emptyState,
}: MediaShelfProps<T>) {
  const name = label ?? heading;

  if (items.length === 0 && emptyState) {
    return (
      <Section heading={heading}>
        <EmptyState icon={emptyState.icon} text={emptyState.text} />
      </Section>
    );
  }

  // The heading is Section's, not a second one written here: a shelf is
  // a section of a page that happens to scroll sideways.
  return (
    <Section heading={heading}>
      <ul
        aria-label={name}
        // A scrollable region has to be reachable by keyboard (WCAG 2.2
        // AA, 2.1.1). When the tiles are buttons, tabbing through them
        // scrolls the rail already; when they are not, the rail itself
        // is the only thing left to focus, so it takes the tab stop.
        tabIndex={onSelect ? undefined : 0}
        // The padding is not decoration: `overflow-x-auto` computes
        // `overflow-y` to `auto` too, so the rail clips on both axes, and
        // a tile's focus ring (2px ring, 2px offset) would be shaved off
        // at the top edge and on the leading tile without room to draw
        // in. Found in a code review, 2026-09-05.
        className={cn("flex min-w-0 list-none snap-x snap-mandatory gap-3 overflow-x-auto p-1.5", FOCUS_RING)}
      >
        {items.map((item) => (
          <li key={getKey(item)} className={cn("flex shrink-0 snap-start flex-col gap-2", SHELF_ITEM_WIDTH[density])}>
            <Card
              onSelect={onSelect ? () => onSelect(item) : undefined}
              label={getLabel?.(item)}
              selected={isSelected?.(item)}
              className={cn(
                "border-0 bg-transparent",
                // The tile's own selected state. Card draws selection as
                // a border color, which a borderless artwork tile zeroes
                // out, so a selected tile was pixel-identical to every
                // other one (code review, 2026-09-05). Two things this
                // had to learn from actually looking at it in a browser:
                // the ring goes on the Card, not on the artwork box
                // inside it, or Card's own `overflow-hidden` clips it
                // away entirely; and it needs the offset, because a cyan
                // ring drawn flush against cyan artwork is invisible.
                isSelected?.(item) &&
                  "ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--background))]",
              )}
            >
              <div
                className={cn(
                  "w-full overflow-hidden rounded-[var(--radius)] bg-[hsl(var(--muted))]",
                  ASPECT_CLASSES[aspect],
                )}
              >
                {renderItem(item)}
              </div>
            </Card>
            {renderCaption ? (
              // Outside the Card, not inside it: a caption is flow
              // content, which is invalid inside a button, and a caption
              // that holds its own control (a channel link, an overflow
              // menu) would be keyboard-unreachable nested in one. Same
              // rule List.renderAction follows.
              <div className="px-1 text-sm text-[hsl(var(--foreground))]">{renderCaption(item)}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
