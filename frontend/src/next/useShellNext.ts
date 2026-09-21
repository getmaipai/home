import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { readShellNextCache, writeShellNextCache } from "@/next/shellNextCache";

export type ShellNextState = "loading" | "on" | "off";

/** `ui.shell.next` (household scope, backend/src/settings/uiKeys.ts): the
 * shell-on-shadcndashboard stand-up's own flag (docs/plans/
 * shell-on-shadcndashboard-2026-09-21.md). Shares HomePage.tsx's own
 * `["settings-values", "household"]` cache entry rather than a second
 * fetch of the same household settings.
 *
 * Returns `"loading"` (not `"off"`) while the query has no data yet -
 * a person who already turned the flag on and opens a `/next` URL
 * directly must not get bounced to `/` just because the household
 * settings fetch hasn't resolved on this page load.
 *
  * SHELL-08 (found live, debugging its own sign-in capture): `isError`
  * IS checked, unlike an earlier draft of this hook - a real race
  * during the in-session sign-out this row's acceptance exercises (a
  * second observer of this same query key refetching right as
  * `/api/auth/logout` invalidates the session) can turn this query's
  * `data` from present to a genuine 401 `isError`, which used to read
  * as `!query.data` forever, spinning `RouteSkeleton` with no way out.
  * `"off"` bounces to `/`, the same honest fallback a resolved-false
  * flag already gives - not a full fix for the cold, never-
  * authenticated case (the plan doc's own separate gap paragraph), but
  * a real failure no longer hangs indefinitely either.
  *
  * HOME-UI-04g: the query's initial state comes from the per-browser
  * cache (`on` -> "on", `off` -> "off", null -> "loading"); when the
  * query resolves, the cache is written with the resolved value so the
  * next reload paints the right palette on first paint. */
export function useShellNext(): ShellNextState {
  const cached = readShellNextCache();
  const state: ShellNextState = cached ? (cached.on ? "on" : "off") : "loading";

  const query = useQuery({
    queryKey: ["settings-values", "household"],
    queryFn: () => api.settingsValues("household"),
    staleTime: 5 * 60 * 1000,
  });

  const written = useRef(false);
  useEffect(() => {
    if (written.current || !query.data) return;
    written.current = true;
    const value: boolean = query.data.find((v) => v.key === "ui.shell.next")?.value === true;
    const look = query.data.find((v) => v.key === "ui.look")?.value ?? "neutral";
    writeShellNextCache({ on: value, look: String(look), dark: false });
  }, [query.data]);

  if (query.isError) return "off";
  if (!query.data) return state;
  return query.data.find((v) => v.key === "ui.shell.next")?.value === true ? "on" : "off";
}
