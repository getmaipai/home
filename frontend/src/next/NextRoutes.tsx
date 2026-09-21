import { Navigate, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import BlankLayout from "@maipai/ui/src/dashboard/layouts/blank/BlankLayout";
import { ThemeProvider } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { useShellNext } from "@/next/useShellNext";
import { useNextLook } from "@/next/useNextLook";
import { useNextAppearance } from "@/next/useNextAppearance";
import { NextDashboardPage } from "@/next/pages/NextDashboardPage";
import { NextChatPage } from "@/next/pages/NextChatPage";
import { NextAppsPage } from "@/next/pages/NextAppsPage";
import { NextPeoplePage } from "@/next/pages/NextPeoplePage";
import { NextSettingsPage } from "@/next/pages/NextSettingsPage";
import { NextEnginesPage } from "@/next/pages/NextEnginesPage";
import { NextUpdatesPage } from "@/next/pages/NextUpdatesPage";
import { NextRepairsPage } from "@/next/pages/NextRepairsPage";
import { NextBackupsPage } from "@/next/pages/NextBackupsPage";
import { NextSignInPage } from "@/next/pages/NextSignInPage";
import type { Roster } from "@/lib/api";

/** The `/next/*` route tree (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md, step 1): behind `ui.shell.next`, mounts the template's
 * FullLayout with Home's sidebar items as data and the template's own
 * views on their own demo data. Redirects to `/` when the flag is off,
 * so the URL itself never leaks a preview nobody turned on.
 *
 * `/next/chat` (CHAT-SDK-01 landed the `@assistant-ui/react@0.15.21`
 * bump the Elements need; SHELL-02 is the wiring): the plan's own
 * "chat's wiring table" first slice - the Elements thread and composer
 * on Home's existing streaming adapter, real turns, reply text and
 * reasoning rendering. NextChatPage.tsx's own header names what's
 * still a follow-up slice (history, thread list, attachments,
 * suggestions, tools, artifacts, read-aloud). */
// HOME-UI-04d: `useNextAppearance` calls the vendored `useTheme()`, so
// it has to run inside `<ThemeProvider>`, not above it - a small inner
// component rather than inlining the hook call in `NextRoutes` itself,
// which needs to return `<ThemeProvider>` before anything inside it
// can call a hook that reads from it.
function NextRoutesInner({ person }: { person: Roster }) {
  useNextAppearance(person.id);

  return (
    <Routes>
      <Route path="sign-in" element={<BlankLayout />}>
        <Route index element={<NextSignInPage />} />
      </Route>
      <Route element={<FullLayout />}>
        <Route index element={<NextDashboardPage person={person} />} />
        <Route path="chat" element={<NextChatPage />} />
        <Route path="apps" element={<NextAppsPage />} />
        <Route path="people" element={<NextPeoplePage person={person} />} />
        <Route path="settings" element={<NextSettingsPage person={person} />} />
        <Route path="engines" element={<NextEnginesPage />} />
        <Route path="updates" element={<NextUpdatesPage />} />
        <Route path="repairs" element={<NextRepairsPage />} />
        <Route path="backups" element={<NextBackupsPage />} />
      </Route>
    </Routes>
  );
}

export function NextRoutes({ person }: { person: Roster }) {
  const shellNext = useShellNext();
  useNextLook(person.id);
  if (shellNext === "loading") return <RouteSkeleton />;
  if (shellNext === "off") return <Navigate to="/" replace />;

  return (
    <ThemeProvider>
      <NextRoutesInner person={person} />
    </ThemeProvider>
  );
}
