// MEM-SPACE-05: the setup wizard's one preset question, asked once the owner exists (settings cannot be written before that).
// It shows only when the Stack can already say what this computer can run; the words are the spec's, as on the Performance page.
import { useState } from "react";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { PRESET_IDS, PRESET_VALUES, specKey, type PresetId } from "@/apps/settings/performanceModel";
import { usePerformanceSettings } from "@/apps/settings/usePerformanceSettings";

const PRESET_TITLES: Record<PresetId, string> = { chat_first: "Chat first", balanced: "Balanced", big_jobs_first: "Big jobs first" };

export function PerformanceStep() {
  const { write } = usePerformanceSettings();
  const [choice, setChoice] = useState<PresetId>("balanced");
  const [error, setError] = useState<string | null>(null);
  const options = specKey("resources.preset").copy?.options ?? {};
  // Saved as soon as it is picked, so Continue only moves on; a failed save says so and keeps the page.
  const pick = (id: PresetId) => {
    setChoice(id); setError(null);
    write({ ...PRESET_VALUES[id], "resources.preset": id }).catch(() => setError("Home could not save that choice. Check your connection and try again; you can also change it later under Settings, then AI and models, then Performance."));
  };
  return (
    <div className="flex flex-col gap-4" data-testid="performance-step">
      <p className="text-base text-muted-foreground md:text-lg">{specKey("resources.preset").help}</p>
      <RadioGroup value={choice} onValueChange={(next) => pick(next as PresetId)}>
        <ItemGroup variant="card">
          {PRESET_IDS.map((id) => (
            <Item key={id} size="setting"><ItemContent><ItemTitle>{PRESET_TITLES[id]}</ItemTitle><ItemDescription clamp={false}>{options[id]}</ItemDescription></ItemContent><ItemActions><RadioGroupItem value={id} aria-label={PRESET_TITLES[id]} /></ItemActions></Item>
          ))}
        </ItemGroup>
      </RadioGroup>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    </div>
  );
}
