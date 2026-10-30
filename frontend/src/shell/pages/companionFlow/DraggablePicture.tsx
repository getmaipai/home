import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_FRAME, type PictureFrame } from "@/shell/pages/companionFlow/PreviewControls";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const KEY_STEP = 0.02;
// The character can be pushed past an edge and zoomed as far as the person likes: the placed picture is cut by the frame.
const POSITION_MIN = -1, POSITION_MAX = 2, ZOOM_MAX = 200;

/**
 * The character picture inside the preview: drag it with a mouse or finger, move it with the arrow keys, zoom with the mouse wheel
 * (or + and -). `frame` is the placement the person wants (zoom 1 and up, x and y the character's centre as fractions of the frame, -1 to 2);
 * `baked` is the placement already drawn into `src`, so the live move is only the difference and the picture does not jump when Home
 * returns the placed version.
 */
export function DraggablePicture({ src, alt, frame, baked = DEFAULT_FRAME, disabled, onFrameChange }: {
  src: string; alt: string; frame: PictureFrame; baked?: PictureFrame; disabled: boolean; onFrameChange: (frame: PictureFrame) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; from: PictureFrame } | null>(null);
  const latest = useRef({ frame, disabled, onFrameChange });
  latest.current = { frame, disabled, onFrameChange };

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      const { frame: current, disabled: off, onFrameChange: change } = latest.current;
      event.preventDefault();
      if (off) return;
      const zoom = Math.round(clamp(current.zoom * Math.exp(-event.deltaY * 0.002), 1, ZOOM_MAX) * 100) / 100;
      if (zoom !== current.zoom) change({ ...current, zoom });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    drag.current = { startX: event.clientX, startY: event.clientY, from: frame };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* the move still arrives while the pointer stays over the box */ }
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current; if (!start || disabled) return;
    const rect = box.current?.getBoundingClientRect(); if (!rect || rect.width === 0 || rect.height === 0) return;
    onFrameChange({ ...start.from, x: clamp(start.from.x + (event.clientX - start.startX) / rect.width, POSITION_MIN, POSITION_MAX), y: clamp(start.from.y + (event.clientY - start.startY) / rect.height, POSITION_MIN, POSITION_MAX) });
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const move = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[event.key];
    if (move) { event.preventDefault(); onFrameChange({ ...frame, x: clamp(Math.round((frame.x + move[0]!) * 100) / 100, POSITION_MIN, POSITION_MAX), y: clamp(Math.round((frame.y + move[1]!) * 100) / 100, POSITION_MIN, POSITION_MAX) }); return; }
    if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault(); onFrameChange({ ...frame, zoom: Math.round(clamp(frame.zoom * (event.key === "-" ? 1 / 1.1 : 1.1), 1, ZOOM_MAX) * 100) / 100 });
    }
  }

  const round = (value: number) => Math.round(value * 1000) / 1000;
  const dx = round((frame.x - baked.x) * 100), dy = round((frame.y - baked.y) * 100), scale = round(frame.zoom / baked.zoom);
  return (
    // The box is one custom control (drag, arrow keys, wheel) with no native element that fits.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div ref={box} role="application" aria-label="Character position. Drag the character or use the arrow keys to move it, and the mouse wheel or the plus and minus keys to zoom."
      tabIndex={disabled ? -1 : 0} data-slot="character-drag" className={`absolute inset-0 touch-none select-none ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
      <img src={src} alt={alt} draggable={false} data-slot="character-picture"
        className="pointer-events-none size-full object-contain origin-(--origin) translate-x-(--dx) translate-y-(--dy) scale-(--scale)"
        style={{ "--origin": `${round(baked.x * 100)}% ${round(baked.y * 100)}%`, "--dx": `${dx}%`, "--dy": `${dy}%`, "--scale": String(scale) } as CSSProperties} />
    </div>
  );
}
