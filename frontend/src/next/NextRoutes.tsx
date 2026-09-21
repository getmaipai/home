import { Navigate, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import BlankLayout from "@maipai/ui/src/dashboard/layouts/blank/BlankLayout";
// Vendored, unmodified (docs/dashboard-upstream.md): its own `:root`/`.dark`
// carry the same hex values as @maipai/ui/src/tokens.css (deliberately kept
// in sync, see globals.css's own header comment), so this and the kit's
// existing stylesheet coexisting is a values-matching no-op today, not a
// silent divergence - the plan's own "no page is composed from both [primitive
// sets]" acknowledges this is a real, temporary cost of the migration
// (docs/plans/shell-on-shadcndashboard-2026-09-21.md), not an oversight.
import "@maipai/ui/src/dashboard/css/globals.css";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { useShellNext } from "@/next/useShellNext";
import { useNextLook } from "@/next/useNextLook";
import { NextDashboardPage } from "@/next/pages/NextDashboardPage";
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
 * `/next/chat` is not wired here yet: the Elements
 * (ui/src/elements/thread.aui.tsx) read a field
 * (`ThreadMessage.metadata.modality`) that `@assistant-ui/react@0.15.18`
 * predates, and this repo's frontend and backend share one bun
 * workspace lockfile - bumping `@assistant-ui/react` far enough to
 * reach it (0.15.21) drags its own newer `zod` dependency across the
 * whole workspace, which breaks unrelated backend code built against
 * an older zod (@modelcontextprotocol/sdk, @hono/zod-openapi). Session
 * B's own item is already reworking the chat's wire shapes against
 * these same Elements (see the plan's "chat's wiring table"), so this
 * is flagged back to the coordinator to decide alongside that work
 * rather than force-upgraded here. */
export function NextRoutes({ person }: { person: Roster }) {
  const shellNext = useShellNext();
  useNextLook(person.id);
  if (shellNext === "loading") return <RouteSkeleton />;
  if (shellNext === "off") return <Navigate to="/" replace />;

  return (
    <Routes>
      <Route path="sign-in" element={<BlankLayout />}>
        <Route index element={<NextSignInPage />} />
      </Route>
      <Route element={<FullLayout />}>
        <Route index element={<NextDashboardPage />} />
        <Route path="apps" element={<NextAppsPage />} />
        <Route path="people" element={<NextPeoplePage />} />
        <Route path="settings" element={<NextSettingsPage />} />
        <Route path="engines" element={<NextEnginesPage />} />
        <Route path="updates" element={<NextUpdatesPage />} />
        <Route path="repairs" element={<NextRepairsPage />} />
        <Route path="backups" element={<NextBackupsPage />} />
      </Route>
    </Routes>
  );
}
