import { i18n } from "@lingui/core";
// MEDIA-VIZ-03: the sleep timer on the mini bar and the Audio page, through the shell's one audio session (its timer already pauses
// the host's element and reaches "end of song").
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { getIcon } from "@maipai/ui/src/icons";
import { useMiniBar } from "@/shell/audioSessionContext";
import { SLEEP_OPTIONS, type SleepOption } from "@/shell/audioSession";

const label = (option: SleepOption) => (option === "end_of_item" ? i18n._({ id: "Stop after this one", message: "Stop after this one" }) : i18n._({ id: "Stop in {minutes} minutes", message: "Stop in {minutes} minutes", values: { minutes: option } }));

export function SleepMenu({ withLabel = false }: { withLabel?: boolean }) {
  const { sleep, startSleepTimer, cancelSleepTimer } = useMiniBar();
  const MoonIcon = getIcon("moon");
  return (
    <span className="inline-flex">
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button type="button" variant="ghost" size={withLabel ? "sm" : "icon"} aria-label={i18n._({ id: "Sleep timer", message: "Sleep timer" })} title={sleep ? i18n._({ id: "Sleep timer is on", message: "Sleep timer is on" }) : i18n._({ id: "Sleep timer", message: "Sleep timer" })}>
          <MoonIcon aria-hidden="true" />{withLabel ? <span>{sleep ? i18n._({ id: "Sleep timer on", message: "Sleep timer on" }) : i18n._({ id: "Sleep timer", message: "Sleep timer" })}</span> : null}
        </Button>
      } />
      <DropdownMenuContent align="end">
        {SLEEP_OPTIONS.map((option) => <DropdownMenuItem key={String(option)} onClick={() => startSleepTimer(option)}>{label(option)}</DropdownMenuItem>)}
        {sleep ? <DropdownMenuItem onClick={() => cancelSleepTimer()}>{i18n._({ id: "Turn off the timer", message: "Turn off the timer" })}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    </span>
  );
}
