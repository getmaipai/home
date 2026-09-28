import { useEffect } from "react";
import { LOOKS, type Look, useLookValue } from "@/next/useLookSetting";
import { readShellNextCache, writeShellNextCache } from "@/next/shellNextCache";

const STYLE_CLASSES = LOOKS.map((look) => `style-${look}`);

/** Applies the person's `ui.look` setting through the template's
 * body-class style variants (the eight shadcn base-color presets in
 * `ui/src/dashboard/css/globals.css`). The value is read from the same
 * settings cache entry the generic renderer writes.
 *
 * HOME-UI-04g: also writes `look` into the per-browser cache so
 * `main.tsx` can paint the right palette before React mounts. */
export function useNextLook(personId: string): Look {
  const look = useLookValue(personId);

  useEffect(() => {
    document.body.classList.remove(...STYLE_CLASSES);
    document.body.classList.add(`style-${look}`);
    const cached = readShellNextCache();
    writeShellNextCache({ look, dark: cached?.dark ?? false });
    return () => {
      document.body.classList.remove(...STYLE_CLASSES);
    };
  }, [look]);

  return look;
}
