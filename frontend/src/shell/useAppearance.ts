import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type Appearance = "system" | "light" | "dark";

const LIGHT_THEME_COLOR = "#ffffff";
const DARK_THEME_COLOR = "#0b0b0f";

function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  if (appearance !== "system") root.classList.add(appearance);

  const isDark =
    appearance === "dark" ||
    (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
}

/** `ui.appearance` (person scope, backend/src/settings/uiKeys.ts), read
 * once and applied to the `<html>` element as the `.dark`/`.light` class
 * `tokens.css`'s theme tokens key off. The one place in the shell that
 * touches `document.documentElement` directly for this - every other
 * appearance-dependent thing in the kit reads the CSS variables, not this
 * hook. */
export function useAppearance(personId: string): {
  appearance: Appearance;
  setAppearance: (value: Appearance) => void;
} {
  const [appearance, setAppearanceState] = useState<Appearance>("system");

  useEffect(() => {
    api
      .settingsValues(`person:${personId}`)
      .then((values) => {
        const found = values.find((v) => v.key === "ui.appearance");
        if (found && typeof found.value === "string") {
          setAppearanceState(found.value as Appearance);
        }
      })
      .catch(() => {
        // A failed read just keeps the "system" default rather than
        // blocking the shell from rendering over a settings fetch.
      });
  }, [personId]);

  useEffect(() => {
    applyAppearance(appearance);
    if (!window.matchMedia("(prefers-color-scheme: dark)").addEventListener) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (appearance === "system") applyAppearance("system");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [appearance]);

  function setAppearance(value: Appearance) {
    setAppearanceState(value);
    api.setSetting(`person:${personId}`, "ui.appearance", value).catch(() => {
      // The optimistic local class switch already applied; a failed
      // write just means it doesn't persist past this session, not that
      // the person's screen silently stays in the old theme.
    });
  }

  return { appearance, setAppearance };
}
