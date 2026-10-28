import { useEffect, useRef } from "react";
import { Label } from "@maipai/ui/src/ui/label";
import { Slider } from "@maipai/ui/src/ui/slider";

const VIEW = 288;
const MAX_OUT = 2048;

type Frame = { zoom: number; x: number; y: number };

/** Keeps the picture covering the square window on any axis where it is larger, and centred where it is smaller. */
function clampFrame(frame: Frame, width: number, height: number): Frame {
  const scale = (VIEW / Math.max(width, height)) * frame.zoom;
  const fit = (offset: number, size: number) => size <= VIEW ? (VIEW - size) / 2 : Math.min(0, Math.max(VIEW - size, offset));
  return { zoom: frame.zoom, x: fit(frame.x, width * scale), y: fit(frame.y, height * scale) };
}

/** The part of the picture inside the window, in the picture's own pixels. Nothing is added around it, so an opaque picture stays opaque. */
export function visibleRegion(frame: Frame, width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = (VIEW / Math.max(width, height)) * frame.zoom;
  const sx = Math.max(0, -frame.x / scale), sy = Math.max(0, -frame.y / scale);
  const ex = Math.min(width, (VIEW - frame.x) / scale), ey = Math.min(height, (VIEW - frame.y) / scale);
  return { sx, sy, sw: Math.max(1, ex - sx), sh: Math.max(1, ey - sy) };
}

/** Loads a picture file for cropping. Resolves null when this browser cannot decode it, so the caller can send the file as it is. */
export function loadPicture(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image.naturalWidth && image.naturalHeight ? image : null); };
    image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    image.src = url;
  });
}

export function cropToFile(image: HTMLImageElement, frame: Frame, name: string): Promise<File | null> {
  const { sx, sy, sw, sh } = visibleRegion(frame, image.naturalWidth, image.naturalHeight);
  const down = Math.min(1, MAX_OUT / Math.max(sw, sh)), canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * down)); canvas.height = Math.max(1, Math.round(sh * down));
  canvas.getContext("2d")?.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? new File([blob], name.replace(/\.[^.]*$/, "") + ".png", { type: "image/png" }) : null), "image/png"));
}

export function initialFrame(width: number, height: number): Frame { return clampFrame({ zoom: 1, x: 0, y: 0 }, width, height); }

export function PictureCropper({ image, frame, onChange }: { image: HTMLImageElement; frame: Frame; onChange: (frame: Frame) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [width, height] = [image.naturalWidth, image.naturalHeight];
  const scale = (VIEW / Math.max(width, height)) * frame.zoom;
  useEffect(() => {
    const context = canvas.current?.getContext("2d"); if (!context) return;
    context.clearRect(0, 0, VIEW, VIEW);
    context.drawImage(image, frame.x, frame.y, width * scale, height * scale);
  }, [image, frame, width, height, scale]);
  function setZoom(zoom: number) {
    // Zoom around the middle of the window so the part being looked at stays put.
    const ratio = zoom / frame.zoom, centre = VIEW / 2;
    onChange(clampFrame({ zoom, x: centre - (centre - frame.x) * ratio, y: centre - (centre - frame.y) * ratio }, width, height));
  }
  return <div className="flex flex-col gap-2">
    <canvas ref={canvas} width={VIEW} height={VIEW} role="img" aria-label="Picture preview. Drag to move the picture." className="h-72 w-72 max-w-full cursor-grab touch-none bg-muted"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: frame.x, y: frame.y }; }}
      onPointerMove={(e) => { const d = drag.current; if (d) onChange(clampFrame({ zoom: frame.zoom, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }, width, height)); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
    <Label htmlFor="look-zoom">Zoom</Label>
    <Slider id="look-zoom" aria-label="Zoom" min={1} max={4} step={0.05} value={[frame.zoom]} onValueChange={([zoom]) => setZoom(zoom ?? 1)} />
    <p className="text-sm text-muted-foreground">Drag to move the picture, zoom to crop in. Small pictures are enlarged for you.</p>
  </div>;
}
