import { useQuery } from "@tanstack/react-query";
import { useState, type ComponentProps } from "react";
import { api } from "@/lib/api";
import { playAlarmSound, type AlarmSoundId, type AlarmVolume } from "@/lib/alarmSounds";
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import { Button } from "@maipai/ui/src/ui/button";
import type { SettingRowProps } from "@maipai/ui/src/settings/SettingRow";

type Props = Omit<ComponentProps<typeof SettingsRenderer>, "rowExtras">;
type Stored = { key: string; value: unknown };

export function ClockCardRenderer(props: Props) {
  const [message, setMessage] = useState("");
  const values = useQuery({ queryKey: ["settings-values", props.scopeValue], queryFn: () => api.settingsValues(props.scopeValue) });
  const sound = (values.data as Stored[] | undefined)?.find((entry) => entry.key === "alarms.sound")?.value as AlarmSoundId | undefined;
  const volume = (values.data as Stored[] | undefined)?.find((entry) => entry.key === "alarms.volume")?.value as AlarmVolume | undefined;
  const rowExtras: Readonly<Record<string, Pick<SettingRowProps, "note" | "lockedReason" | "action">>> = sound ? {
    "alarms.sound": {
      action: { label: "Preview", onPress: () => {
        const playback = playAlarmSound(sound, volume ?? "medium");
        if (playback.blocked) setMessage("Tap to turn the sound on");
        else setMessage("");
      } },
    },
  } : {};
  return <>
    <SettingsRenderer {...props} rowExtras={rowExtras} />
    {message ? <Button variant="outline" onClick={() => {
      const playback = playAlarmSound(sound ?? "bell", volume ?? "medium");
      if (!playback.blocked) setMessage("");
    }}>{message}</Button> : null}
  </>;
}
