import { i18n } from "@lingui/core";
// MEDIA-PARITY-02: the quick Equalizer menu beside the sleep timer. Four presets; the choice is the person's `music.eq_preset` setting.
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { getIcon } from "@maipai/ui/src/icons";
import { EQ_PRESET_IDS, eqSupported, type EqPreset } from "@/lib/media/audioGraph";
import { chooseEqPreset, useEqPreset } from "@/shell/media/eqPreset";

export const eqLabel = (preset: EqPreset): string => {
  if (preset === "bass") return i18n._({ id: "Bass boost", message: "Bass boost" });
  if (preset === "treble") return i18n._({ id: "Treble boost", message: "Treble boost" });
  if (preset === "vocal") return i18n._({ id: "Vocal", message: "Vocal" });
  return i18n._({ id: "Flat", message: "Flat" });
};

export function EqualizerMenu({ withLabel = false }: { withLabel?: boolean }) {
  const preset = useEqPreset();
  const Icon = getIcon("sliders-horizontal");
  if (!eqSupported()) return null;
  const name = i18n._({ id: "Equalizer: {name}", message: "Equalizer: {name}", values: { name: eqLabel(preset) } });
  return (
    <span className="inline-flex">
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button type="button" variant="ghost" size={withLabel ? "sm" : "icon"} aria-label={name} title={name}>
          <Icon aria-hidden="true" />{withLabel ? <span>{name}</span> : null}
        </Button>
      } />
      <DropdownMenuContent align="end">
        {EQ_PRESET_IDS.map((id) => <DropdownMenuItem key={id} onClick={() => chooseEqPreset(id)}>{id === preset ? "✓ " : ""}{eqLabel(id)}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    </span>
  );
}
