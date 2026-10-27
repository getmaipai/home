// MEDIA-VIZ-03: the sleep timer on the mini bar and the Music page, through the shell's one audio session (its timer already pauses
// the host's element and reaches "end of song").
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { getIcon } from "@maipai/ui/src/icons";
import { useMiniBar } from "@/shell/audioSessionContext";
import { SLEEP_OPTIONS, type SleepOption } from "@/shell/audioSession";

const label = (option: SleepOption) => (option === "end_of_item" ? "End of this one" : `In ${option} minutes`);

export function SleepMenu({ withLabel = false }: { withLabel?: boolean }) {
  const { sleep, startSleepTimer, cancelSleepTimer } = useMiniBar();
  const MoonIcon = getIcon("moon");
  return (
    <span className="inline-flex">
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button type="button" variant="ghost" size={withLabel ? "sm" : "icon"} aria-label="Sleep timer" title={sleep ? "Sleep timer is on" : "Sleep timer"}>
          <MoonIcon aria-hidden="true" />{withLabel ? <span>{sleep ? "Sleep timer on" : "Sleep timer"}</span> : null}
        </Button>
      } />
      <DropdownMenuContent align="end">
        {SLEEP_OPTIONS.map((option) => <DropdownMenuItem key={String(option)} onClick={() => startSleepTimer(option)}>Stop {label(option).toLowerCase()}</DropdownMenuItem>)}
        {sleep ? <DropdownMenuItem onClick={() => cancelSleepTimer()}>Turn off the timer</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    </span>
  );
}
