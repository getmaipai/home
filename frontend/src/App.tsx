import { lazy, Suspense, useEffect, useState, type ComponentProps, type ComponentType } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes as RouterRoutes, Route, Navigate } from "react-router-dom";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/i18n";
import { createQueryClient } from "@/lib/queryClient";
import { LegacyShellRedirect } from "@/shell/LegacyShellRedirect";
import { useHouseholdLocale } from "@/shell/useHouseholdLocale";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { ErrorBoundary } from "@maipai/ui/src/primitives/ErrorBoundary";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { api, type SignedInPerson } from "@/lib/api";
import { SessionLockGate } from "@/shell/sessionLockContext";

// A failed chunk fetch uses the shared stale-chunk retry wired in
// main.tsx; lazy routes do not need a separate reload path.
function lazyNamed<P extends object = Record<string, never>>(
  loader: () => Promise<Record<string, unknown>>,
  name: string,
) {
  return lazy(() => loader().then((m) => ({ default: m[name] as ComponentType<P> })));
}

// Setup remains a separate first-run route. The migrated application
// shell owns every other route from the root, while the preview bookmark prefix remains a
// compatibility route for bookmarks and links made during preview.
const SetupWizard = lazyNamed<ComponentProps<typeof import("@/apps/setup/SetupWizard")["SetupWizard"]>>(
  () => import("@/apps/setup/SetupWizard"),
  "SetupWizard",
);
// FACE-02: another Wizard-driven, shell-less full-page route (the same
// reason /setup lives here instead of under Routes - Wizard.tsx's
// own <main> would double up on FullLayout's landmark if nested inside
// it), so it's registered directly here rather than as a Routes
// child even though its entry point lives on the (Routes-hosted)
// profile page.
const FaceEnrollmentPage = lazyNamed<ComponentProps<typeof import("@/apps/people/FaceEnrollmentPage")["FaceEnrollmentPage"]>>(
  () => import("@/apps/people/FaceEnrollmentPage"),
  "FaceEnrollmentPage",
);
const Routes = lazyNamed<ComponentProps<typeof import("@/shell/Routes")["Routes"]>>(
  () => import("@/shell/Routes"),
  "Routes",
);

// One QueryClient for the app's lifetime (docs/plans/session-b-ui.md
// step 3): created once, outside the component, not per render.
const queryClient = createQueryClient();

// The root route is the migrated shell. Setup stays separate because it
// must remain addressable before a household profile exists.
export function App() {
  const [person, setPerson] = useState<SignedInPerson | null | undefined>(undefined);

  // Fail-closed: used only where "we don't yet know who's signed in" is
  // the real question (first load, right after sign-in) - api.me()
  // failing there genuinely means treat this as signed out.
  function loadPerson() {
    return api
      .me()
      .then(setPerson)
      .catch(() => setPerson(null));
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
    loadPerson();
  }, []);

  useHouseholdLocale(person != null);

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
                <BrowserRouter>
                  <RouterRoutes>
                    <Route
                      path="/setup"
                      element={
                        <Suspense fallback={<RouteSkeleton />}>
                          <SetupWizard onDone={loadPerson} />
                        </Suspense>
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
                    <Route
                      path="/next/*"
                      element={<LegacyShellRedirect />}
                    />
                    <Route path="/conversations" element={<LegacyShellRedirect />} />
                    <Route path="/settings/users" element={<LegacyShellRedirect />} />
                    <Route path="/settings/models" element={<LegacyShellRedirect />} />
                    <Route path="/settings/backups" element={<LegacyShellRedirect />} />
                    <Route path="/settings/voices" element={<LegacyShellRedirect />} />
                    <Route path="/settings/commands" element={<LegacyShellRedirect />} />
                    <Route path="/settings/devices" element={<LegacyShellRedirect />} />
                    <Route path="/settings/repairs" element={<LegacyShellRedirect />} />
                    <Route path="/settings/updates" element={<LegacyShellRedirect />} />
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
                </BrowserRouter>
              </SessionLockGate>
            </TooltipProvider>
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
