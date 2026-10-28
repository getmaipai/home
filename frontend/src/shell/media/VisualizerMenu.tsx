// MEDIA-VIZ-03: the scene menu on the mini bar and the Music page: None, then each scene. One app-wide choice (AudioVisualizer's prefs),
// the pre-rebuild hub's visualizer menu. Its icon is the equalizer bars: the waveform is the voice icon in chat.
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { getIcon } from "@maipai/ui/src/icons";
import { VISUALIZERS, setVisualizerEnabled, setVisualizerPref, useVisualizerEnabled, useVisualizerPref } from "@/shell/media/AudioVisualizer";

export function VisualizerMenu({ withLabel = false }: { withLabel?: boolean }) {
  const enabled = useVisualizerEnabled();
  const variant = useVisualizerPref();
  const SceneIcon = getIcon("equalizer");
  const current = enabled ? VISUALIZERS.find((v) => v.id === variant)?.label ?? "On" : "Off";
  return (
    <span className="inline-flex">
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button type="button" variant="ghost" size={withLabel ? "sm" : "icon"} aria-label={`Visualizer: ${current}`} title={`Visualizer: ${current}`}>
          <SceneIcon aria-hidden="true" />{withLabel ? <span>Visualizer: {current}</span> : null}
        </Button>
      } />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setVisualizerEnabled(false)}>{!enabled ? "✓ " : ""}None</DropdownMenuItem>
        {VISUALIZERS.map((v) => (
          <DropdownMenuItem key={v.id} onClick={() => { setVisualizerPref(v.id); setVisualizerEnabled(true); }}>{enabled && v.id === variant ? "✓ " : ""}{v.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    </span>
  );
}
