import { useEffect } from "react";
import { ACCENT_LABELS } from "@/apps/people/roles";

function isAccent(value: unknown): value is keyof typeof ACCENT_LABELS {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACCENT_LABELS, value);
}

/** The signed-in person's `Person.accent` (one of the six named swatches),
 * painted on `<body data-accent>`. `tokens.css` points the shell's
 * `--accent` and `--sidebar-accent` tokens (the selected and hover
 * surfaces the kit already draws) at the matching kit
 * `--profile-accent-<name>` pair, so the accent shows on every page, not
 * only the Family cards. No accent set means no attribute and the look's
 * own tokens stand. The one writer of the attribute, the way `useLook`
 * is the one writer of the body's `style-*` class. */
export function useAccent(accent: string | null | undefined): void {
  useEffect(() => {
    if (isAccent(accent)) document.body.setAttribute("data-accent", accent);
    else document.body.removeAttribute("data-accent");
    return () => {
      document.body.removeAttribute("data-accent");
    };
  }, [accent]);
}
