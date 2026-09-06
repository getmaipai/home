import { useState, type CSSProperties } from "react";
import { Slider } from "@/kit/ui/slider";
import { getIcon } from "@/kit/icons";

export const CARD_SIZE_MIN = 180;
export const CARD_SIZE_MAX = 560;
export const CARD_SIZE_DEFAULT = 220;
export const CARD_SIZE_STEP = 20;

/** The CSS custom property every card-size-aware grid reads. One name,
 * set once per app on whichever container wraps its grids
 * (`cardSizeStyle`, below) - a descendant grid (`cardSizeGridTemplateColumns`)
 * never needs the size threaded to it as a prop. */
const CARD_SIZE_VAR = "--maipai-card-size";

function storageKey(appId: string): string {
  return `maipai:card-size:${appId}`;
}

function clamp(n: number): number {
  return Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, Math.round(n)));
}

// Per app, per device, on purpose (the Photos/Plex toolbar-zoom
// pattern this control is named after, session-e-ui-and-docs.md step
// 2): the right density is a property of the screen someone is looking
// at, not something to carry between a phone and a wall display, and
// docs/SETTINGS.md has no "per device" scope to begin with - inventing
// one just for this slider would be a second definition for something
// that already has an honest home in the browser it belongs to.
// localStorage, not a synced setting.
export function useCardSize(appId: string): [number, (next: number) => void] {
  const [size, setSize] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(appId));
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? clamp(parsed) : CARD_SIZE_DEFAULT;
    } catch {
      return CARD_SIZE_DEFAULT;
    }
  });

  function update(next: number) {
    const clamped = clamp(next);
    setSize(clamped);
    try {
      window.localStorage.setItem(storageKey(appId), String(clamped));
    } catch {
      // A read-only/private-mode localStorage just means the choice
      // doesn't persist past this visit, not that the slider stops
      // working for the rest of the session.
    }
  }

  return [size, update];
}

/** Applied to whichever container wraps an app's card-size-aware grids
 * (docs/BACKLOG.md/session-e-ui-and-docs.md: "one CSS variable every
 * grid consumes"). */
export function cardSizeStyle(size: number): CSSProperties {
  return { [CARD_SIZE_VAR]: `${size}px` } as CSSProperties;
}

/** Read by a card-size-aware grid (widget_card's `NodeRenderer.tsx`
 * view). `220px` is `CARD_SIZE_DEFAULT`: a page that never wraps its
 * content in `cardSizeStyle` (no slider on screen) still gets a sane
 * grid instead of a bare `var()` falling through to `auto`. */
export function cardSizeGridTemplateColumns(): string {
  return `repeat(auto-fill, minmax(var(${CARD_SIZE_VAR}, ${CARD_SIZE_DEFAULT}px), 1fr))`;
}

const SmallIcon = getIcon("layout-grid");
const LargeIcon = getIcon("grid-2x2");

// Controlled, not its own `useCardSize` call: a caller applying the size
// to a grid via `cardSizeStyle` (HomePage.tsx) needs to react to a drag
// too, and two independent hook instances for the same `appId` don't
// share state - each has its own `useState`, so dragging this slider
// updated only its own copy and localStorage while the caller's own
// `size` (and the grid's CSS variable) never changed until a remount (a
// code review, 2026-09-06, caught this: the thumb moved, the cards
// never resized). One `useCardSize(appId)` call per app, passed down.
export function CardSizeSlider({
  size,
  onChange,
  label = "Card size",
}: {
  size: number;
  onChange: (next: number) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <SmallIcon aria-hidden className="size-4" />
      <Slider
        aria-label={label}
        min={CARD_SIZE_MIN}
        max={CARD_SIZE_MAX}
        step={CARD_SIZE_STEP}
        value={[size]}
        onValueChange={(next) => {
          if (next[0] !== undefined) onChange(next[0]);
        }}
        className="w-28"
      />
      <LargeIcon aria-hidden className="size-5" />
    </div>
  );
}
