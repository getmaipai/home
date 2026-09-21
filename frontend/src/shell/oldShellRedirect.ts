import type { ShellNextState } from "@/next/useShellNext";

/** SHELL-FLAG-01: the decision logic behind App.tsx's own OldShellRoutes,
 * pulled out on its own so it's testable without importing App.tsx -
 * that file also imports @/i18n, which pulls in a .po file bun's test
 * runtime has no loader for (unlike the real Vite build, which does).
 * Kept as plain functions, not a hook: no React state of their own,
 * just pathname + the already-resolved flag in, a decision out.
 *
 * A code review flagged this as a second, independent place branching
 * on ShellNextState's three values, next to NextRoutes.tsx's own
 * inline `=== "loading"`/`=== "off"` checks - a real duplication, not
 * consolidated here deliberately: COORDINATOR's own brief for this
 * item asked not to touch useShellNext's shape (or its one existing
 * consumer) more than this redirect needed, since HOME-UI-04g's own
 * in-flight branch already has a rebase pending against NextRoutes.tsx
 * and a wider touch there would only make that conflict bigger. Worth
 * a real shared predicate once that lands. */

/** "/" redirects to /next once the flag resolves on - not any other
 * old-shell path, and not while the flag is still "loading" (that's
 * isRootStillResolving's own case, below). */
export function shouldRedirectRootToNext(pathname: string, shellNext: ShellNextState): boolean {
  return pathname === "/" && shellNext === "on";
}

/** "/" shows a skeleton rather than a flash of the old shell's own
 * Home while the flag is still resolving - it might land on `on` a
 * moment later, and rendering the old shell first would be exactly
 * the flash this item exists to remove. Any OTHER old-shell path
 * renders immediately, flag state or not; only the root redirect
 * itself needs to wait on it. */
export function isRootStillResolving(pathname: string, shellNext: ShellNextState): boolean {
  return pathname === "/" && shellNext === "loading";
}

/** Where a sign-out from the old shell should land: /next/sign-in once
 * the flag is on, or null (stay in place - the old shell's own inline
 * <SignIn/> takes over, unchanged from before this item) otherwise. */
export function signOutDestination(shellNext: ShellNextState): string | null {
  return shellNext === "on" ? "/next/sign-in" : null;
}
