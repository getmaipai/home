import { HomeTooltipIconButton } from "@/apps/chat/HomeTooltipIconButton";
import { getIcon } from "@maipai/ui/src/icons";
import type { Roster } from "@/lib/api";
import { useDeviceWakeWordSetting } from "@/apps/chat/useDeviceWakeWordSetting";

const MicIcon = getIcon("mic");

export function ComposerWakeWordControl({ person }: { person: Roster }) {
  const wakeWord = useDeviceWakeWordSetting(person);
  if (!wakeWord.adult || !wakeWord.available || wakeWord.loading) return null;
  const label = wakeWord.enabled ? "Turn off wake word listening" : "Turn on wake word listening";
  return (
    <HomeTooltipIconButton
      tooltip={wakeWord.enabled ? "Wake word listening is on" : "Turn on wake word listening"}
      type="button"
      variant={wakeWord.enabled ? "default" : "outline"}
      size="icon"
      className="size-7 rounded-full"
      aria-label={label}
      aria-pressed={wakeWord.enabled}
      onClick={() => void wakeWord.setEnabled(!wakeWord.enabled)}
    >
      <MicIcon className="size-4" />
    </HomeTooltipIconButton>
  );
}
