import { useSyncExternalStore } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import type { Appearance } from "@/shell/useAppearance";

// The header's theme toggle (spec "The shell, exactly": "theme toggle
// (sun or moon icon button)") - a single two-state button, matching the
// reference, wired to Home's own appearance system (useAppearance.ts:
// a person-scoped `ui.appearance` setting applied as a `.dark`/`.light`
// class on <html>), not the kit's AppearanceControl: that component
// assumes a next-themes ThemeProvider, which neither the kit's Shell
// nor Home mounts - Home already had its own real system before this
// step, "the kit gets a slot, Home keeps the feature" (AppShell.tsx's
// own header comment), the same reason PinToggle/ModelPicker/
// NotificationBell/ProfileSwitcher are Home's own components too.
function isDarkNow(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  if (root.classList.contains("dark")) return true;
  if (root.classList.contains("light")) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    mql.removeEventListener("change", onChange);
  };
}

// Exported so the phone header's own avatar-menu row (a text row, not
// this file's icon button) can show and act on the same live state
// without a second copy of the class-observer/media-query wiring -
// found needing this reading HOME-UI-02f's own scope, "search, theme
// and the bell move under the avatar's menu."
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDarkNow, () => false);
}

export interface ThemeToggleProps {
  setAppearance: (value: Appearance) => void;
}

export function ThemeToggle({ setAppearance }: ThemeToggleProps) {
  const dark = useIsDark();
  const SunIcon = getIcon("sun");
  const MoonIcon = getIcon("moon");
  const Icon = dark ? SunIcon : MoonIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light appearance" : "Switch to dark appearance"}
      onClick={() => setAppearance(dark ? "light" : "dark")}
    >
      <Icon aria-hidden />
    </Button>
  );
}
