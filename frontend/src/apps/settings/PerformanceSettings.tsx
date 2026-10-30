// MEM-SPACE-04 / MEM-SPACE-09: Settings > AI and models > Performance (admins only). Three presets, the Close apps card, and Customize as the one home of the priorities panel and the profile table. No status strip and no numbers on the first view (making-space note section 5; rule S6).
import { useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { CloseAppsSettings } from "@/apps/settings/CloseAppsSettings";
import { PerformanceCustomize } from "@/apps/settings/PerformanceCustomize";
import { PRESET_IDS, PRESET_VALUES, currentPreset, specKey, type PresetId } from "@/apps/settings/performanceModel";
import { usePerformanceSettings } from "@/apps/settings/usePerformanceSettings";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

const PRESET_TITLES: Record<PresetId, string> = { chat_first: "Chat first", balanced: "Balanced", big_jobs_first: "Big jobs first" };

export function PerformanceSettings(_props: SettingsViewProps) {
  const { ready, value, write } = usePerformanceSettings();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ready) return null;
  const preset = currentPreset(value);
  const options = specKey("resources.preset").copy?.options ?? {};
  // Choosing a preset writes its values once; the preset key follows so a later hand edit can show Custom.
  const choose = (id: PresetId) => { setError(null); write({ ...PRESET_VALUES[id], "resources.preset": id }).catch(() => setError("Home could not save that change. Check your connection and try again.")); };
  const onCustomize = (changes: Record<string, unknown>) => write({ ...changes, "resources.preset": "custom" });
  return (
    <div data-testid="performance-settings">
      <Card>
        <CardHeader>
          <CardTitle>{specKey("resources.preset").label}{preset === "custom" ? <> <Badge>Custom</Badge></> : null}</CardTitle>
          <CardDescription>{specKey("resources.preset").help}</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={preset === "custom" ? "" : preset} onValueChange={(next) => choose(next as PresetId)}>
            <ItemGroup variant="card">
              {PRESET_IDS.map((id) => (
                <Item key={id} size="setting">
                  <ItemContent><ItemTitle>{PRESET_TITLES[id]}</ItemTitle><ItemDescription clamp={false}>{options[id]}</ItemDescription></ItemContent>
                  <ItemActions><RadioGroupItem value={id} aria-label={PRESET_TITLES[id]} /></ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </RadioGroup>
          {error ? <p role="alert">{error}</p> : null}
          <p>Turn Boost or Max on or off per job on the AI and models page.</p>
        </CardContent>
      </Card>
      <CloseAppsSettings value={value} write={write} />
      <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="outline" />}>{customizeOpen ? "Hide customize" : "Customize"}</CollapsibleTrigger>
        <CollapsibleContent><PerformanceCustomize value={value} write={onCustomize} /></CollapsibleContent>
      </Collapsible>
    </div>
  );
}
