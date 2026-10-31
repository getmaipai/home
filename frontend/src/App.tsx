import { Suspense, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes as RouterRoutes, Route, Navigate, useLocation } from "react-router-dom";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/i18n";
import { createQueryClient } from "@/lib/queryClient";
import { retiredManagePageTarget } from "@/shell/pages/settings/settingsRedirects";
import { settingsPath } from "@/shell/pages/settings/settingsAreas";
import type { SignedInPerson } from "@/lib/api";
import { useHouseholdLocale } from "@/shell/useHouseholdLocale";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { lazyNamed } from "@/shell/lazyNamed";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { ErrorBoundary } from "@maipai/ui/src/primitives/ErrorBoundary";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { api } from "@/lib/api";
import { nextMediaOwner, reconcileKept, setMediaOwner } from "@/lib/offlineMedia";
import { SessionLockGate } from "@/shell/sessionLockContext";
import { PreviewRuntime } from "@/apps/setup/preview/PreviewRuntime";
import { ThemeProvider } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";

// Setup remains a separate first-run route. The migrated application
// shell owns every other route from the root, while the preview bookmark prefix remains a
// compatibility route for bookmarks and links made during preview.
const SetupWizard = lazyNamed(
  () => import("@/apps/setup/SetupWizard"),
  "SetupWizard",
);
const AwayFromHome = lazyNamed(
  () => import("@/apps/setup/AwayFromHome"),
  "AwayFromHome",
);
// FACE-02: another Wizard-driven, shell-less full-page route (the same
// reason /setup lives here instead of under Routes - Wizard.tsx's
// own <main> would double up on FullLayout's landmark if nested inside
// it), so it's registered directly here rather than as a Routes
// child even though its entry point lives on the (Routes-hosted)
// profile page.
const FaceEnrollmentPage = lazyNamed(
  () => import("@/apps/people/FaceEnrollmentPage"),
  "FaceEnrollmentPage",
);
const Routes = lazyNamed(
  () => import("@/shell/Routes"),
  "Routes",
);

// One QueryClient for the app's lifetime (docs/plans/session-b-ui.md
// step 3): created once, outside the component, not per render.
const queryClient = createQueryClient();

function AliasRedirect({ path, person }: { path: string; person: SignedInPerson | null | undefined }) {
  const location = useLocation();
  const canManageHousehold = person?.role === "owner" || person?.role === "admin";
  const destinations: Record<string, string> = {
    "/conversations": "/chat",
    "/settings/users": settingsPath("household", "people"),
    "/settings/backups": settingsPath("backups"),
    "/settings/commands": settingsPath("home-voice", "commands"),
    "/settings/devices": settingsPath("profile", "profile"),
    "/settings/repairs": settingsPath("advanced"),
    "/settings/updates": settingsPath("backups", "updates"),
  };
  const destination = destinations[path]
    ?? (path === "/settings/models" ? retiredManagePageTarget("/models", { canManageHousehold }) : undefined)
    ?? (path === "/settings/voices" ? retiredManagePageTarget("/voices", { canManageHousehold }) : undefined)
    ?? path;
  const params = new URLSearchParams(location.search);
  if (path === "/conversations" && !params.has("list")) params.set("list", "1");
  const query = params.size > 0 ? `?${params}` : "";
  return <Navigate to={`${destination}${query}${location.hash}`} replace />;
}

// The root route is the migrated shell. Setup stays separate because it
// must remain addressable before a household profile exists.
export function App() {
  const [person, setPerson] = useState<SignedInPerson | null | undefined>(undefined);
  const [mediaOwnerId, setMediaOwnerId] = useState<string | null>(null);

  // Fail-closed: used only where "we don't yet know who's signed in" is
  // the real question (first load, right after sign-in) - api.me()
  // failing there genuinely means treat this as signed out.
  function loadPerson() {
    return api
      .me()
      .then((me) => { setPerson(me); setMediaOwnerId((previous) => nextMediaOwner(previous, { person: me })); })
      .catch((error) => { setPerson(null); setMediaOwnerId((previous) => nextMediaOwner(previous, { error })); });
  }

  // A code review (2026-09-04) found ChangeSecretSection's onChanged
  // reusing loadPerson's fail-closed behavior for the wrong question: a
  // person who just successfully changed their own PIN is definitely
  // still signed in (the session cookie is untouched by a secret
  // change), so a transient network blip on this re-fetch should not
  // silently drop them to the sign-in screen. This only updates on
  // success and leaves the existing `person` alone otherwise.
  function revalidatePerson() {
    return api.me().then(setPerson).catch(() => {});
  }

  useEffect(() => {
    if (__SETUP_PREVIEW__) setPerson(null);
    else loadPerson();
  }, []);

  useHouseholdLocale(!__SETUP_PREVIEW__ && person != null);

  // Kept media copies belong to the signed-in person: tell the worker who that is (null while signed out or expired, so
  // nothing is served), then drop any copy the hub says is gone or changed, now and whenever the browser is back online.
  // The owner is not `person`: an unreachable hub turns `person` null, but must not lock the kept copies (see nextMediaOwner).
  const personId = mediaOwnerId;
  useEffect(() => {
    if (__SETUP_PREVIEW__) return;
    void setMediaOwner(personId).then(() => { if (personId) void reconcileKept(); });
    if (!personId) return;
    const online = () => void reconcileKept();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [personId]);

  // The router now wraps every state (loading, signed out, mid-setup,
  // signed in), not just the authenticated tree: `/setup` needs to be a
  // real, addressable, reloadable route (platform plan 6.4's Wizard
  // pattern - "resume after reload" - and the join-flow QR a phone scans
  // both need a real URL to land on, not a conditionally-rendered
  // component with no path of its own the way the old inline first-run
  // form had).
  return (
    <ErrorBoundary>
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <TooltipProvider>
              <SessionLockGate person={person ?? null}>
                <ThemeProvider storageKey={__SETUP_PREVIEW__ ? "setup-preview-theme" : "vite-ui-theme"}><BrowserRouter>
                  <RouterRoutes>
                    <Route
                      path="/setup"
                      element={
                        <Suspense fallback={<RouteSkeleton />}>
                          {__SETUP_PREVIEW__ ? <PreviewRuntime><SetupWizard onDone={loadPerson} /></PreviewRuntime> : <SetupWizard onDone={loadPerson} initialScreen={new URLSearchParams(window.location.search).get("checksReview") === "1" ? "checks" : undefined} />}
                        </Suspense>
                      }
                    />
                    <Route
                      path="/setup/away"
                      element={
                        person === undefined ? (
                          <div className="flex h-screen items-center justify-center">
                            <Progress mode="spinner" label="Loading MaiPai Home" />
                          </div>
                        ) : (
                          <Suspense fallback={<RouteSkeleton />}>
                            <AwayFromHome operator={person} />
                          </Suspense>
                        )
                      }
                    />
                    <Route
                      path="/people/:id/enroll-face"
                      element={
                        person === undefined ? (
                          <div className="flex h-screen items-center justify-center">
                            <Progress mode="spinner" label="Loading MaiPai Home" />
                          </div>
                        ) : person === null ? (
                          <Navigate to="/sign-in" replace />
                        ) : (
                          <Suspense fallback={<RouteSkeleton />}>
                            <FaceEnrollmentPage operator={person} />
                          </Suspense>
                        )
                      }
                    />
                    <Route path="/conversations" element={<AliasRedirect path="/conversations" person={person} />} />
                    <Route path="/settings/users" element={<AliasRedirect path="/settings/users" person={person} />} />
                    <Route path="/settings/models" element={<AliasRedirect path="/settings/models" person={person} />} />
                    <Route path="/settings/backups" element={<AliasRedirect path="/settings/backups" person={person} />} />
                    <Route path="/settings/voices" element={<AliasRedirect path="/settings/voices" person={person} />} />
                    <Route path="/settings/commands" element={<AliasRedirect path="/settings/commands" person={person} />} />
                    <Route path="/settings/devices" element={<AliasRedirect path="/settings/devices" person={person} />} />
                    <Route path="/settings/repairs" element={<AliasRedirect path="/settings/repairs" person={person} />} />
                    <Route path="/settings/updates" element={<AliasRedirect path="/settings/updates" person={person} />} />
                    <Route
                      path="/*"
                      element={
                        person === undefined ? (
                          <div className="flex h-screen items-center justify-center">
                            <Progress mode="spinner" label="Loading MaiPai Home" />
                          </div>
                        ) : (
                          <Suspense fallback={<RouteSkeleton />}>
                            <Routes person={person} onSignedIn={loadPerson} onPersonChange={revalidatePerson} />
                          </Suspense>
                        )
                      }
                    />
                  </RouterRoutes>
                </BrowserRouter></ThemeProvider>
              </SessionLockGate>
            </TooltipProvider>
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
