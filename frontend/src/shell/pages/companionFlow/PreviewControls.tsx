import { Label } from "@maipai/ui/src/ui/label";
import { Slider } from "@maipai/ui/src/ui/slider";

export type PictureFrame = { zoom: number; x: number; y: number };
export const DEFAULT_FRAME: PictureFrame = { zoom: 1, x: 0.5, y: 0.5 };

/** The zoom slider under the preview, and (when `position` is set) the two position sliders. The background is always removed, so there is no switch. */
export function PreviewControls({ frame, disabled, idPrefix = "character", position = false, onFrameChange, onFrameCommit }: {
  /** Distinguishes two sets of controls on one page (screen 1 stays mounted behind screen 2). */
  idPrefix?: string;
  frame: PictureFrame; disabled: boolean;
  /** Show the left-right and up-down sliders too (screen 1 drags the picture instead). */
  position?: boolean;
  onFrameChange: (frame: PictureFrame) => void; onFrameCommit?: (frame: PictureFrame) => void;
}) {
  const slider = (key: keyof PictureFrame, label: string, min: number, max: number, step: number) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
      <Slider id={`${idPrefix}-${key}`} aria-label={label} min={min} max={max} step={step} value={[frame[key]]} disabled={disabled}
        onValueChange={([value]) => onFrameChange({ ...frame, [key]: value ?? DEFAULT_FRAME[key] })}
        onValueCommit={onFrameCommit ? ([value]) => onFrameCommit({ ...frame, [key]: value ?? DEFAULT_FRAME[key] }) : undefined} />
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      {slider("zoom", "Zoom", 1, 20, 0.1)}
      {position ? <>{slider("x", "Left and right", -1, 2, 0.01)}{slider("y", "Up and down", -1, 2, 0.01)}</> : null}
    </div>
  );
}
