import { lazy, Suspense, useEffect, useState, type ComponentProps, type ComponentType } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/i18n";
import { createQueryClient } from "@/lib/queryClient";
import { SignIn } from "@/shell/SignIn";
import { AppShell } from "@/shell/AppShell";
import { MemoriesRedirect } from "@/shell/MemoriesRedirect";
import { useHouseholdLocale } from "@/shell/useHouseholdLocale";
import { ChatPage } from "@/apps/chat/ChatPage";
import { HomePage } from "@/apps/home/HomePage";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { ErrorBoundary } from "@maipai/ui/src/primitives/ErrorBoundary";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { api, type Roster } from "@/lib/api";

// A small helper for a named export, since `lazy()` itself only takes a
// promise of `{ default }` - every page below is a named export, not a
// default one, and repeating `.then((m) => ({ default: m.X }))` 15 times
// inline would bury the one line that actually matters (which route).
// `P` defaults to "no props at all" so the four routes that really take
// none (`NotificationsPage`, `DevicesPage`, `PeoplePage`, `PrivacyPage`)
// need no type argument, rather than a second, separate convention
// alongside the `ComponentProps<...>` calls below - a review, 2026-09-13.
//
// A failed chunk fetch (a stale tab's own index.html pointing at a
// hash a newer deploy already dropped) needs no handling here: it
// rejects as a plain `import()` failure, which Vite's own runtime
// turns into a `vite:preloadError` on `window` - `src/lib/pwaBoot.ts`'s
// `installStaleChunkRetry` (wired in `main.tsx`) already listens for
// exactly that, reloading once against the SAME shared, capped retry
// budget every other boot-resilience guard in this app uses. A review
// (2026-09-13) first added a second, per-chunk reload path here before
// finding that shared mechanism - reverted, since two uncoordinated
// reload guards for the identical failure is the precise bug
// `pwaBoot.ts`'s own header comment documents fixing once already
// (2026-09-06, up to six reload cycles from two independent caps).
function lazyNamed<P extends object = Record<string, never>>(
  loader: () => Promise<Record<string, unknown>>,
  name: string,
) {
  return lazy(() => loader().then((m) => ({ default: m[name] as ComponentType<P> })));
}


// Lane 10 item 2 (docs/BACKLOG.md's "Real code-splitting for the frontend
// shell chunk"): every app EXCEPT Home and Chat becomes its own chunk,
// dynamic-imported only once its route is actually visited - Home and
// Chat are what a signed-in person's very first paint renders on
// essentially every session, so keeping them eager avoids trading "a
// smaller shell" for "a loading flash on the one screen everybody hits
// every time." The shell and the kit stay in the entry chunk too (they
// render on every route, lazy-loading them would just delay the first
// paint instead of shrinking it).
// `ComponentProps<typeof import("path")["Name"]>` - a type-only query,
// erased at build, never a real eager import - derives each page's
// props from its own real signature instead of a hand-typed copy that
// could drift the moment that signature changes without this call site
// changing to match (a review, 2026-09-13, found the hand-typed version
// wouldn't have caught exactly that drift for any of these 15). Left
// off entirely for the four pages that take no props at all
// (`NotificationsPage`, `DevicesPage`, `PeoplePage`, `PrivacyPage`):
// TypeScript infers `unknown`, not `{}`, from a truly zero-parameter
// function component's `ComponentProps` (a documented inference quirk),
// so `lazyNamed`'s own default (`Record<string, never>`, "no props")
// covers them instead.
const AppsPage = lazyNamed<ComponentProps<typeof import("@/apps/library/AppsPage")["AppsPage"]>>(
  () => import("@/apps/library/AppsPage"),
  "AppsPage",
);
const SetupWizard = lazyNamed<ComponentProps<typeof import("@/apps/setup/SetupWizard")["SetupWizard"]>>(
  () => import("@/apps/setup/SetupWizard"),
  "SetupWizard",
);
const NotificationsPage = lazyNamed(() => import("@/apps/notifications/NotificationsPage"), "NotificationsPage");
const SearchPage = lazyNamed<ComponentProps<typeof import("@/apps/search/SearchPage")["SearchPage"]>>(
  () => import("@/apps/search/SearchPage"),
  "SearchPage",
);
const SettingsPage = lazyNamed<ComponentProps<typeof import("@/apps/settings/SettingsPage")["SettingsPage"]>>(
  () => import("@/apps/settings/SettingsPage"),
  "SettingsPage",
);
const ModelsPage = lazyNamed<ComponentProps<typeof import("@/apps/settings/ModelsPage")["ModelsPage"]>>(
  () => import("@/apps/settings/ModelsPage"),
  "ModelsPage",
);
const BackupsPage = lazyNamed<ComponentProps<typeof import("@/apps/settings/BackupsPage")["BackupsPage"]>>(
  () => import("@/apps/settings/BackupsPage"),
  "BackupsPage",
);
const VoicesPage = lazyNamed<ComponentProps<typeof import("@/apps/settings/VoicesPage")["VoicesPage"]>>(
  () => import("@/apps/settings/VoicesPage"),
  "VoicesPage",
);
const CommandsPage = lazyNamed<ComponentProps<typeof import("@/apps/settings/CommandsPage")["CommandsPage"]>>(
  () => import("@/apps/settings/CommandsPage"),
  "CommandsPage",
);
const RepairsPage = lazyNamed<ComponentProps<typeof import("@/apps/settings/RepairsPage")["RepairsPage"]>>(
  () => import("@/apps/settings/RepairsPage"),
  "RepairsPage",
);
const HealthSection = lazyNamed<ComponentProps<typeof import("@/apps/settings/HealthSection")["HealthSection"]>>(
  () => import("@/apps/settings/HealthSection"),
  "HealthSection",
);
const UsersPage = lazyNamed<ComponentProps<typeof import("@/apps/settings/UsersPage")["UsersPage"]>>(
  () => import("@/apps/settings/UsersPage"),
  "UsersPage",
);
const DevicesPage = lazyNamed(() => import("@/apps/settings/DevicesPage"), "DevicesPage");
const PeoplePage = lazyNamed<ComponentProps<typeof import("@/apps/people/PeoplePage")["PeoplePage"]>>(
  () => import("@/apps/people/PeoplePage"),
  "PeoplePage",
);
const PersonProfilePage = lazyNamed<
  ComponentProps<typeof import("@/apps/people/PersonProfilePage")["PersonProfilePage"]>
>(() => import("@/apps/people/PersonProfilePage"), "PersonProfilePage");
const PrivacyPage = lazyNamed(() => import("@/apps/privacy/PrivacyPage"), "PrivacyPage");

// One QueryClient for the app's lifetime (docs/plans/session-b-ui.md
// step 3): created once, outside the component, not per render.
const queryClient = createQueryClient();

// Sign-in gate -> shell -> routed pages. A router (react-router-dom)
// landed with the Settings page, the second page to exist tonight -
// docs/UI.md's "don't invent ahead of need" is why it wasn't added for
// Chat alone.
export function App() {
  const [person, setPerson] = useState<Roster | null | undefined>(undefined);

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
              <BrowserRouter>
                <Routes>
                  <Route
                    path="/setup"
                    element={
                      <Suspense fallback={<RouteSkeleton />}>
                        <SetupWizard onDone={loadPerson} />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/*"
                    element={
                      person === undefined ? (
                        <div className="flex h-screen items-center justify-center">
                          <Progress mode="spinner" label="Loading MaiPai Home" />
                        </div>
                      ) : person === null ? (
                        <SignIn onSignedIn={loadPerson} />
                      ) : (
                        <AppShell
                          person={person}
                          onSignOut={() => api.logout().finally(() => setPerson(null))}
                          onPersonChange={revalidatePerson}
                        >
                          <Suspense fallback={<RouteSkeleton />}>
                            <Routes>
                              <Route path="/" element={<HomePage person={person} />} />
                              <Route path="/apps" element={<AppsPage person={person} />} />
                              <Route path="/chat" element={<ChatPage person={person} />} />
                              {/* Conversations is Chat's own thread list now, not a
                                  destination of its own (owner ruling, "Navigation,
                                  corrected," 2026-09-20) - `?list=1` opens the phone
                                  sheet ChatPage.tsx already renders; the desktop
                                  column is always visible, so this redirect is
                                  already "the list open" there without it. */}
                              <Route path="/conversations" element={<Navigate to="/chat?list=1" replace />} />
                              <Route path="/notifications" element={<NotificationsPage />} />
                              <Route path="/search" element={<SearchPage person={person} />} />
                              <Route path="/people" element={<PeoplePage person={person} />} />
                              <Route path="/people/:id" element={<PersonProfilePage person={person} />} />
                              {/* Memories belong to a person now (same ruling): both
                                  spellings of the old destination redirect to the
                                  signed-in person's own Memories tab, so nothing
                                  bookmarked breaks. */}
                              <Route path="/memory" element={<MemoriesRedirect selfId={person.id} />} />
                              <Route path="/memories" element={<MemoriesRedirect selfId={person.id} />} />
                              <Route path="/privacy" element={<PrivacyPage />} />
                              <Route
                                path="/settings"
                                element={<SettingsPage person={person} onPersonChange={revalidatePerson} />}
                              >
                                {/* Nested (2026-09-06), not sibling routes: navigating to
                                    one of these used to unmount SettingsPage entirely,
                                    taking the tree rail/Household-Me switcher/search box
                                    down with it. SettingsPage renders these through its
                                    own <Outlet/>, so its chrome stays put. */}
                                <Route path="users" element={<UsersPage person={person} />} />
                                <Route path="models" element={<ModelsPage person={person} />} />
                                <Route path="backups" element={<BackupsPage person={person} />} />
                                <Route path="voices" element={<VoicesPage person={person} />} />
                                <Route path="commands" element={<CommandsPage person={person} />} />
                                <Route path="devices" element={<DevicesPage />} />
                                <Route path="repairs" element={<RepairsPage person={person} />} />
                                {/* No AdminGatedContent wrapper, unlike Repairs
                                    and Backups above it: Health is
                                    informational for every signed-in household
                                    member (app.ts's healthRoute is requireAuth,
                                    not requireRole), so HealthSection gates
                                    only its own restart control, not the page. */}
                                <Route path="health" element={<HealthSection person={person} />} />
                              </Route>
                            </Routes>
                          </Suspense>
                        </AppShell>
                      )
                    }
                  />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
