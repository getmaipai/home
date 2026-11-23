import { i18n } from "@lingui/core";
import type { PendingTrack } from "./musicHandoff";

/** The mini player while the clicked song loads: the pressed row's title, artist line and artwork with a loading status,
 * so the press feels instant even though the first byte has not arrived yet. */
export function MusicPendingBar({ pending }: { pending: PendingTrack }) {
  return (
    <div data-testid="music-player-pending" className="flex items-center gap-3">
      {pending.artworkUrl ? <img src={pending.artworkUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" /> : null}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{pending.title}</span>
        {pending.subtitle ? <span className="truncate text-xs text-muted-foreground">{pending.subtitle}</span> : null}
      </div>
      <span role="status" className="text-xs text-muted-foreground">{i18n._({ id: "Loading", message: "Loading" })}</span>
    </div>
  );
}
