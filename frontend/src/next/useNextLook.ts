import { useEffect } from "react";
import { type Look, useLookValue } from "@/shell/useLook";

/** `ui.look` (person scope, the same key `@/shell/useLook.ts` reads for
 * the old shell's `data-look` attribute) applied to the `/next` stand-up
 * instead as the vendored template's own body-class style-variant
 * mechanism (`.style-calm`/`.style-studio`, ui/src/dashboard/css/
 * globals.css) - a different mechanism, the same setting, per the plan's
 * own "Looks" ruling (docs/plans/shell-on-shadcndashboard-2026-09-21.md:
 * "ui.look keeps selecting between them"). Resolution itself
 * (`useLookValue`) is shared with the old shell's `useLook` - only the
 * effect that applies it differs. */
export function useNextLook(personId: string): Look {
  const look = useLookValue(personId);

  useEffect(() => {
    document.body.classList.remove("style-calm", "style-studio");
    document.body.classList.add(`style-${look}`);
    return () => {
      document.body.classList.remove("style-calm", "style-studio");
    };
  }, [look]);

  return look;
}
