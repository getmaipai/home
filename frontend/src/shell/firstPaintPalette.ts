import { resolveDark } from "@/shell/appearanceResolve";
import { readShellCache } from "@/shell/shellCache";
import { DEFAULT_LOOK } from "@/shell/useLookSetting";

/** Paint the palette before React mounts. A cached shell preference wins;
 * fresh browsers use the default look and follow the OS appearance. */
export function applyFirstPaintPalette(): void {
  const cached = readShellCache();
  document.body.classList.add(`style-${cached?.look ?? DEFAULT_LOOK}`);
  const dark = cached?.dark ?? resolveDark("system", window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
}
