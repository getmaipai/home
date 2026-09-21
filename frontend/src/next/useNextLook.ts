import { useEffect } from "react";
import { LOOKS, type Look, useLookValue } from "@/shell/useLook";
import { readShellNextCache, writeShellNextCache } from "@/next/shellNextCache";

const STYLE_CLASSES = LOOKS.map((look) => `style-${look}`);

/** `ui.look` (person scope, the same key `@/shell/useLook.ts` reads for
 * the old shell's `data-look` attribute) applied to the `/next` stand-up
 * instead as the vendored template's own body-class style-variant
 * mechanism (the eight shadcn base-color presets, ui/src/dashboard/css/
 * globals.css) - a different mechanism, the same setting, per the
 * plan's own "Looks" ruling (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md: "ui.look keeps selecting between them"). Resolution
 * itself (`useLookValue`) is shared with the old shell's `useLook` -
 * only the effect that applies it differs.
 *
 * HOME-UI-04g: also writes `look` into the per-browser cache so
 * `main.tsx` can paint the right palette before React mounts. */
export function useNextLook(personId: string): Look {
  const look = useLookValue(personId);

  useEffect(() => {
    document.body.classList.remove(...STYLE_CLASSES);
    document.body.classList.add(`style-${look}`);
    const cached = readShellNextCache();
    if (cached) writeShellNextCache({ ...cached, look });
    return () => {
      document.body.classList.remove(...STYLE_CLASSES);
    };
  }, [look]);

  return look;
}
