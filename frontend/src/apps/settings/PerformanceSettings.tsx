// MEM-SPACE-04 / MEM-SPACE-09: Settings > AI and models > Performance (admins only). Three presets, the Close apps card, and Customize as the one home of the priorities panel and the profile table. No status strip and no numbers on the first view (making-space note section 5; rule S6).
import { i18n } from "@lingui/core";
import { useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { CapabilityTable } from "@/apps/settings/CapabilityTable";
import { FreeUpMemory } from "@/apps/settings/FreeUpMemory";
import { HostTuneSettings } from "@/apps/settings/HostTuneSettings";
import { CloseAppsSettings } from "@/apps/settings/CloseAppsSettings";
import { PerformanceCustomize } from "@/apps/settings/PerformanceCustomize";
import { PRESET_IDS, PRESET_VALUES, currentPreset, specKey, type PresetId } from "@/apps/settings/performanceModel";
import { usePerformanceSettings } from "@/apps/settings/usePerformanceSettings";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

const presetTitles = (): Record<PresetId, string> => ({ chat_first: i18n._({ id: "Chat first", message: "Chat first" }), balanced: i18n._({ id: "Balanced", message: "Balanced" }), big_jobs_first: i18n._({ id: "Big jobs first", message: "Big jobs first" }) });

export function PerformanceSettings({ person }: SettingsViewProps) {
  const { ready, value, write } = usePerformanceSettings();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ready) return null;
  const preset = currentPreset(value);
  const options = specKey("resources.preset").copy?.options ?? {};
  // Choosing a preset writes its values once; the preset key follows so a later hand edit can show Custom.
  const choose = (id: PresetId) => { setError(null); write({ ...PRESET_VALUES[id], "resources.preset": id }).catch(() => setError(i18n._({ id: "Home could not save that change. Check your connection and try again.", message: "Home could not save that change. Check your connection and try again." }))); };
  const onCustomize = (changes: Record<string, unknown>) => write({ ...changes, "resources.preset": "custom" });
  return (
    <div data-testid="performance-settings">
      <Card>
        <CardHeader>
          <CardTitle>{specKey("resources.preset").label}{preset === "custom" ? <> <Badge>{i18n._({ id: "Custom", message: "Custom" })}</Badge></> : null}</CardTitle>
          <CardDescription>{specKey("resources.preset").help}</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={preset === "custom" ? "" : preset} onValueChange={(next) => choose(next as PresetId)}>
            <ItemGroup variant="card">
              {PRESET_IDS.map((id) => (
                <Item key={id} size="setting">
                  <ItemContent><ItemTitle>{presetTitles()[id]}</ItemTitle><ItemDescription clamp={false}>{options[id]}</ItemDescription></ItemContent>
                  <ItemActions><RadioGroupItem value={id} aria-label={presetTitles()[id]} /></ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </RadioGroup>
          {error ? <p role="alert">{error}</p> : null}
          <p>{i18n._({ id: "Turn Boost or Max on or off per job on the AI and models page.", message: "Turn Boost or Max on or off per job on the AI and models page." })}</p>
        </CardContent>
      </Card>
      <FreeUpMemory />
      <CloseAppsSettings value={value} write={write} />
      <CapabilityTable path="/api/performance/capabilities" framed />
      {person.role === "owner" ? <HostTuneSettings /> : null}
      <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="outline" />}>{customizeOpen ? i18n._({ id: "Hide customize", message: "Hide customize" }) : i18n._({ id: "Customize", message: "Customize" })}</CollapsibleTrigger>
        <CollapsibleContent><PerformanceCustomize value={value} write={onCustomize} /></CollapsibleContent>
      </Collapsible>
    </div>
  );
}
