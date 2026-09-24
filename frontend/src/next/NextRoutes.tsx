import { useEffect, useRef } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import BlankLayout from "@maipai/ui/src/dashboard/layouts/blank/BlankLayout";
import { ThemeProvider } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { useShellNext } from "@/next/useShellNext";
import { useNextLook } from "@/next/useNextLook";
import { useNextAppearance } from "@/next/useNextAppearance";
import { NextPageHeaderTitle } from "@/next/nextPageHeaderTitle";
import { NextDashboardPage } from "@/next/pages/NextDashboardPage";
import { NextChatPage } from "@/next/pages/NextChatPage";
import { NextAppsPage } from "@/next/pages/NextAppsPage";
import { NextPeoplePage } from "@/next/pages/NextPeoplePage";
import { NextSettingsPage } from "@/next/pages/NextSettingsPage";
import { NextEnginesPage } from "@/next/pages/NextEnginesPage";
import { NextPerformancePage } from "@/next/pages/NextPerformancePage";
import { NextUpdatesPage } from "@/next/pages/NextUpdatesPage";
import { NextRepairsPage } from "@/next/pages/NextRepairsPage";
import { NextBackupsPage } from "@/next/pages/NextBackupsPage";
import { NextSignInPage } from "@/next/pages/NextSignInPage";
import { ChatHeaderDataProvider } from "@/apps/chat/chatHeaderData";
import { api, type Roster } from "@/lib/api";

/** The `/next/*` route tree (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md, step 1): behind `ui.shell.next`, mounts the template's
 * FullLayout with Home's sidebar items as data and the template's own
 * views on their own demo data. Redirects to `/` when the flag is off,
 * so the URL itself never leaks a preview nobody turned on.
 *
 * `/next/chat` (CHAT-SDK-01 landed the `@assistant-ui/react@0.15.21`
 * bump the Elements need; SHELL-02 is the wiring, one slice at a
 * time): the Elements thread and composer on Home's existing
 * streaming adapter, real turns, reply text and reasoning rendering
 * (slice 1), joined by the thread list and history (slice 2).
 * NextChatPage.tsx's own header names what's still a follow-up slice
 * (attachments, suggestions, tools, artifacts, read-aloud).
 *
 * SHELL-08: `person` is `Roster | null` now, not required - `App.tsx`
 * used to redirect a signed-out visitor straight to `/` before this
 * tree ever mounted (its own former comment: "the flag itself is a
 * household setting, so reading it needs a session"), which meant
 * `/next/sign-in` was never actually reachable, only a stub with no
 * props wired. A `null` person renders `NextSignedOutRoutes` instead
 * of the authenticated tree - `useShellNext()`'s own settings query
 * still resolves for this case because the household scope is
 * readable by ANY signed-in person (`assertCanAccessScope`'s own
 * read branch) and, for the realistic path this row's acceptance
 * actually asks for (a real sign-out from within an already-open
 * `/next`, not a cold browser typing the URL first), the query's own
 * cache from before signing out is still warm - no page reload
 * happens on a sign-out, only `App.tsx`'s own `setPerson(null)`. A
 * genuinely cold, never-authenticated load of `/next/sign-in` is a
 * real, separate, out-of-scope gap: `GET /api/settings` is
 * `requireAuth`, so nothing can resolve `ui.shell.next` at all before
 * a session exists - named in the plan doc's own gap paragraph, not
 * silently left to spin forever unremarked. */
// CHAT-HEADER-02: a sibling of the chat route, never an ancestor of
// it - `NextChatPage.tsx` already owns `HeaderExtraLeft` for its own
// lifetime (`useHeaderExtra(ChatHeaderBar)`), and `useHeaderExtra`'s
// own effect only fires on mount/unmount of its CALLER, not on every
// route change. Nesting this as an ancestor of chat too would race
// the two calls' mount order on navigating into or out of chat,
// sometimes leaving the slot on the wrong component (found designing
// this, not live) - a true sibling route means only one of the two
// is ever mounted for a given `/next/*` path, so each owns the slot
// cleanly for its own lifetime, the same pattern chat already proves.
function NextPageHeaderLayout() {
  useHeaderExtra(NextPageHeaderTitle);
  return <Outlet />;
}

// HOME-UI-04d: `useNextAppearance` calls the vendored `useTheme()`, so
// it has to run inside `<ThemeProvider>`, not above it - a small inner
// component rather than inlining the hook call in `NextRoutes` itself,
// which needs to return `<ThemeProvider>` before anything inside it
// can call a hook that reads from it.
function NextRoutesInner({ person }: { person: Roster }) {
  useNextAppearance(person.id);
  useNextLook(person.id);

  return (
    // CHAT-HEADER-01: wraps every /next page (a Route element, never a
    // per-page one) since FullLayout's own Header - where ChatHeaderBar
    // actually renders (a sibling of this Outlet, not a descendant) -
    // needs the SAME provider instance NextChatPage writes into.
    <ChatHeaderDataProvider>
      <Routes>
        {/* Reachable only while signed out (NextSignedOutRoutes below) -
            an already-authenticated visit to this URL has nothing to do
            here, so it bounces to the dashboard instead of a blank
            no-match. */}
        <Route path="sign-in" element={<Navigate to="/next" replace />} />
        {/* SHELL-SEARCH-02: api.search, home's own header wiring for the
            kit's HeaderSearch remote prop (FullLayout -> Header ->
            HeaderSearch, a plain prop threaded down since FullLayout is
            the one component this file actually instantiates itself). */}
        <Route element={<FullLayout headerSearchRemote={api.search} />}>
          <Route path="chat" element={<NextChatPage person={person} />} />
          <Route element={<NextPageHeaderLayout />}>
            <Route index element={<NextDashboardPage person={person} />} />
            <Route path="apps" element={<NextAppsPage />} />
            <Route path="people" element={<NextPeoplePage person={person} />} />
            <Route path="settings" element={<NextSettingsPage person={person} />} />
            <Route path="engines" element={<NextEnginesPage />} />
            <Route path="performance" element={<NextPerformancePage />} />
            <Route path="updates" element={<NextUpdatesPage person={person} />} />
            <Route path="repairs" element={<NextRepairsPage person={person} />} />
            <Route path="backups" element={<NextBackupsPage person={person} />} />
          </Route>
        </Route>
      </Routes>
    </ChatHeaderDataProvider>
  );
}

function NextSignedOutRoutes({ onSignedIn }: { onSignedIn: () => void }) {
  return (
    <Routes>
      <Route path="sign-in" element={<BlankLayout />}>
        <Route index element={<NextSignInPage onSignedIn={onSignedIn} />} />
      </Route>
      {/* Any other /next/* path while signed out (including bare
          /next) lands on the sign-in screen, not a blank no-match -
          the same "nothing renders before someone is signed in"
          posture the old shell's own SignIn.tsx documents. */}
      <Route path="*" element={<Navigate to="sign-in" replace />} />
    </Routes>
  );
}

// HOME-UI-04g: while the household settings query is still loading, the
// per-browser cache (read inside `useShellNext`) decides which palette
// to paint. If it says "on", `useShellNext` itself paints the template's
// look class on the body and the cache is seeded so `main.tsx` painted
// it before React mounted; the old shell's RouteSkeleton stands as the
// loading indicator. If it says null or "off", the old shell's navy
// palette and RouteSkeleton stand - the person either never visited
// /next or the flag was off, so the old shell's loading state is fine.
export function NextRoutes({ person, onSignedIn }: { person: Roster | null; onSignedIn: () => void }) {
  const queryClient = useQueryClient();
  const wasSignedOut = useRef(person === null);
  // A code review, SHELL-08: `useShellNext()`'s own query, once it 401s
  // (the race its own doc comment above names), stays in `isError`
  // forever - `retry: false` and nothing else ever refetches it, so a
  // person who then signs back in for real would be silently bounced
  // back to `/` by the stale error, not the fresh, now-valid session.
  // Invalidated the moment `person` goes from `null` to a real Roster
  // (a genuine sign-in just completed, not a mere re-render) so the
  // next read is a fresh one against the new session.
  useEffect(() => {
    if (wasSignedOut.current && person !== null) {
      void queryClient.invalidateQueries({ queryKey: ["settings-values", "household"] });
    }
    wasSignedOut.current = person === null;
  }, [person, queryClient]);

  const shellNext = useShellNext();

  if (shellNext === "loading") {
    return (
      <div data-testid="next-loading-branch">
        <RouteSkeleton />
      </div>
    );
  }
  if (shellNext === "off") return <Navigate to="/" replace />;

  return <ThemeProvider>{person === null ? <NextSignedOutRoutes onSignedIn={onSignedIn} /> : <NextRoutesInner person={person} />}</ThemeProvider>;
}
