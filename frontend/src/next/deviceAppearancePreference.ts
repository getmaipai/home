import { isAppearance, type Appearance } from "@/next/appearanceResolve";

const KEY = "maipai.ui.appearance.device";
const EVENT = "maipai:device-appearance-change";

/** Browser-only convenience; null means inherit the person's setting. */
export function readDeviceAppearancePreference(): Appearance | null {
  try {
    const value = localStorage.getItem(KEY);
    return isAppearance(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeDeviceAppearancePreference(value: Appearance | null): void {
  try {
    if (value === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {
    // Storage can be blocked in private windows; keep the page usable.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function subscribeDeviceAppearancePreference(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
