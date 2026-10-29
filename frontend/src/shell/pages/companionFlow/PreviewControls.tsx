import { Label } from "@maipai/ui/src/ui/label";
import { Slider } from "@maipai/ui/src/ui/slider";
import { Switch } from "@maipai/ui/src/ui/switch";

export type PictureFrame = { zoom: number; x: number; y: number };
export const DEFAULT_FRAME: PictureFrame = { zoom: 1, x: 0.5, y: 0.5 };

/** The two small controls under the preview: remove the background, and zoom and position. Each change is applied when the person lets go. */
export function PreviewControls({ removeBackground, frame, disabled, idPrefix = "character", onRemoveBackground, onFrameChange, onFrameCommit }: {
  /** Distinguishes two sets of controls on one page (screen 1 stays mounted behind screen 2). */
  idPrefix?: string;
  removeBackground: boolean; frame: PictureFrame; disabled: boolean;
  onRemoveBackground: (value: boolean) => void; onFrameChange: (frame: PictureFrame) => void; onFrameCommit: (frame: PictureFrame) => void;
}) {
  const slider = (key: keyof PictureFrame, label: string, min: number, max: number, step: number) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
      <Slider id={`${idPrefix}-${key}`} aria-label={label} min={min} max={max} step={step} value={[frame[key]]} disabled={disabled}
        onValueChange={([value]) => onFrameChange({ ...frame, [key]: value ?? DEFAULT_FRAME[key] })}
        onValueCommit={([value]) => onFrameCommit({ ...frame, [key]: value ?? DEFAULT_FRAME[key] })} />
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${idPrefix}-remove-background`}>Remove background</Label>
        <Switch id={`${idPrefix}-remove-background`} checked={removeBackground} disabled={disabled} onCheckedChange={onRemoveBackground} />
      </div>
      {slider("zoom", "Zoom", 1, 4, 0.1)}
      {slider("x", "Left and right", 0, 1, 0.01)}
      {slider("y", "Up and down", 0, 1, 0.01)}
    </div>
  );
}
