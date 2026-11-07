import { i18n } from "@lingui/core";
// MEDIA-VIZ-03: "Minimize" on a play page (Now playing, Watch): leave the page and keep playing in the global mini player, as the
// pre-rebuild hub's minimize button did. The media host already holds the element, so going back is all it takes; with no page to go
// back to (a link opened in a new tab) it goes to the app's own home.
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { useNavigate } from "react-router-dom";
import { navigateBack } from "./navigateBack";

/** The router numbers its history entries from 0 at each page load, so a number above 0 means the previous entry is inside this load
 * (going back crosses no full page load, which would end the playback). */
export function MinimizeButton({ appHome }: { appHome: string }) {
  const navigate = useNavigate();
  const MinimizeIcon = getIcon("minimize");
  return (
    <span className="inline-flex" data-slot="media-minimize">
    <Button type="button" variant="ghost" size="sm" aria-label={i18n._({ id: "Minimize to the mini player", message: "Minimize to the mini player" })} title={i18n._({ id: "Minimize: keep playing in the mini player", message: "Minimize: keep playing in the mini player" })} onClick={() => navigateBack(navigate, appHome)}>
      <MinimizeIcon aria-hidden="true" /><span className="max-sm:sr-only">{i18n._({ id: "Minimize", message: "Minimize" })}</span></Button>
    </span>
  );
}
