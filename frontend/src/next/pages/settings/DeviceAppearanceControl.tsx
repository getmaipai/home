import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { api } from "@/lib/api";
import { readDeviceAppearancePreference, writeDeviceAppearancePreference } from "@/next/deviceAppearancePreference";
import { isAppearance, type Appearance } from "@/next/appearanceResolve";

/** Account > Appearance, view `account.device_appearance`: a look for this
 * browser only, kept on the device and never written to the person's own
 * setting. Drawn from the kit's Item parts as they ship. */
export function DeviceAppearanceControl() {
  const [value, setValue] = useState<Appearance | null>(() => readDeviceAppearancePreference());
  const registry = useQuery<SettingsKey[]>({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity });
  const declaration = registry.data?.find((item) => item.key === "ui.appearance");
  const options = ((declaration?.range as { options?: string[] } | undefined)?.options ?? []).filter(isAppearance);
  return (
    <section aria-label="On this device only" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">On this device only</h2>
      <ItemGroup variant="card">
        <Item size="setting">
          <ItemContent>
            <ItemTitle>Look on this device</ItemTitle>
            <ItemDescription>Choose a look for this browser. It does not change your personal setting.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select value={value ?? "inherit"} onValueChange={(next) => { const appearance = next === "inherit" ? null : isAppearance(next) ? next : null; setValue(appearance); writeDeviceAppearancePreference(appearance); }}>
              <SelectTrigger size="row" aria-label="On this device only"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Use my setting</SelectItem>
                {options.map((option) => <SelectItem key={option} value={option}>{option[0]!.toUpperCase() + option.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="secondary" size="row" aria-label="Reset device appearance" onClick={() => { setValue(null); writeDeviceAppearancePreference(null); }}>Reset</Button>
          </ItemActions>
        </Item>
      </ItemGroup>
    </section>
  );
}
