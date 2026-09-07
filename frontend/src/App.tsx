import { AppsPage } from "@/apps/library/AppsPage";
import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/i18n";
import { createQueryClient } from "@/lib/queryClient";
import { SignIn } from "@/shell/SignIn";
import { Shell } from "@/shell/Shell";
import { useHouseholdLocale } from "@/shell/useHouseholdLocale";
import { SetupWizard } from "@/apps/setup/SetupWizard";
import { ChatPage } from "@/apps/chat/ChatPage";
import { ConversationsPage } from "@/apps/conversations/ConversationsPage";
import { NotificationsPage } from "@/apps/notifications/NotificationsPage";
import { HomePage } from "@/apps/home/HomePage";
import { SearchPage } from "@/apps/search/SearchPage";
import { SettingsPage } from "@/apps/settings/SettingsPage";
import { ModelsPage } from "@/apps/settings/ModelsPage";
import { BackupsPage } from "@/apps/settings/BackupsPage";
import { VoicesPage } from "@/apps/settings/VoicesPage";
import { CommandsPage } from "@/apps/settings/CommandsPage";
import { RepairsPage } from "@/apps/settings/RepairsPage";
import { HealthSection } from "@/apps/settings/HealthSection";
import { UsersPage } from "@/apps/settings/UsersPage";
import { DevicesPage } from "@/apps/settings/DevicesPage";
import { PeoplePage } from "@/apps/people/PeoplePage";
import { MemoryPage } from "@/apps/memory/MemoryPage";
import { PrivacyPage } from "@/apps/privacy/PrivacyPage";
import { Progress } from "@/kit/primitives/Progress";
import { ToastProvider } from "@/kit/primitives/Toast";
import { TooltipProvider } from "@/kit/ui/tooltip";
import { api, type Roster } from "@/lib/api";

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
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TooltipProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/setup" element={<SetupWizard onDone={loadPerson} />} />
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
                      <Shell
                        person={person}
                        onSignOut={() => api.logout().finally(() => setPerson(null))}
                        onPersonChange={revalidatePerson}
                      >
                        <Routes>
                          <Route path="/" element={<HomePage person={person} />} />
                          <Route path="/apps" element={<AppsPage person={person} />} />
                          <Route path="/chat" element={<ChatPage person={person} />} />
                          <Route path="/conversations" element={<ConversationsPage person={person} />} />
                          <Route path="/notifications" element={<NotificationsPage />} />
                          <Route path="/search" element={<SearchPage />} />
                          <Route path="/people" element={<PeoplePage />} />
                          <Route path="/memory" element={<MemoryPage person={person} />} />
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
                            {/* No AdminGatedContent wrapper, unlike its
                                Maintenance-group siblings: Health is
                                informational for every signed-in household
                                member (app.ts's healthRoute is requireAuth,
                                not requireRole), so HealthSection gates
                                only its own restart control, not the page. */}
                            <Route path="health" element={<HealthSection person={person} />} />
                          </Route>
                        </Routes>
                      </Shell>
                    )
                  }
                />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </ToastProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
