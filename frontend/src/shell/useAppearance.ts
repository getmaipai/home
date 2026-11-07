import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useHubMutation } from "@/lib/useHubMutation";
import { useSharedReads } from "@/lib/sharedReads";

export type Appearance = "system" | "light" | "dark";

function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  const isDark =
    appearance === "dark" ||
    (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  // Always a concrete class, "system" included (HOME-UI-04b, found live
  // on /apps): the kit's own components never needed one - they
  // read the CSS variables, which already follow `@media (prefers-
  // color-scheme: dark)` with no class required - but the vendored
  // shadcndashboard template's `dark:*` Tailwind utilities are governed
  // by this project's own `@custom-variant dark (&:is(.dark *))`
  // (dashboard/css/globals.css), which matches only a literal `.dark`
  // ancestor, never the media query. Leaving both classes off under
  // "system" (the default for every real person) left every vendored
  // `dark:*` utility dead - found as invisible near-black text on a
  // dark card (DataTable.tsx's `text-gray-900 dark:text-white`, one of
  // several such rows). Setting the resolved class here, always, fixes
  // every current and future vendored component that uses the standard
  // convention, not just this one row.
  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
  const background = getComputedStyle(root).getPropertyValue("--background").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background || "Canvas");
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
  const reads = useSharedReads();
  const touched = useRef({ personId, value: false });
  const save = useHubMutation({ verb: "save your appearance", mutationFn: (value: Appearance) => api.setSetting(`person:${personId}`, "ui.appearance", value) });

  useEffect(() => {
    let cancelled = false;
    if (touched.current.personId !== personId) { touched.current.personId = personId; touched.current.value = false; setAppearanceState("system"); }
    reads
      .settingsValues(`person:${personId}`)
      .then((values) => {
        if (cancelled || touched.current.value) return;
        const found = values.find((v) => v.key === "ui.appearance");
        if (found && typeof found.value === "string") {
          setAppearanceState(found.value as Appearance);
        }
      })
      .catch(() => {
        // A failed read just keeps the "system" default rather than
        // blocking the shell from rendering over a settings fetch.
      });
    return () => { cancelled = true; };
  }, [personId, reads]);

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
    touched.current.personId = personId;
    touched.current.value = true;
    setAppearanceState(value);
    void save.run(value);
  }

  return { appearance, setAppearance };
}
