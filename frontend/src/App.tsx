import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { createQueryClient } from "@/lib/queryClient";
import { SignIn } from "@/shell/SignIn";
import { Shell } from "@/shell/Shell";
import { ChatPage } from "@/apps/chat/ChatPage";
import { HomePage } from "@/apps/home/HomePage";
import { SearchPage } from "@/apps/search/SearchPage";
import { SettingsPage } from "@/apps/settings/SettingsPage";
import { ModelsPage } from "@/apps/settings/ModelsPage";
import { BackupsPage } from "@/apps/settings/BackupsPage";
import { VoicesPage } from "@/apps/settings/VoicesPage";
import { CommandsPage } from "@/apps/settings/CommandsPage";
import { UsersPage } from "@/apps/settings/UsersPage";
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

  if (person === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Progress mode="spinner" label="Loading MaiPai Home" />
      </div>
    );
  }

  if (person === null) {
    return <SignIn onSignedIn={loadPerson} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <BrowserRouter>
            <Shell
              person={person}
              onSignOut={() => api.logout().finally(() => setPerson(null))}
              onPersonChange={revalidatePerson}
            >
              <Routes>
                <Route path="/" element={<HomePage person={person} />} />
                <Route path="/chat" element={<ChatPage person={person} />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/people" element={<PeoplePage />} />
                <Route path="/memory" element={<MemoryPage />} />
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
                </Route>
              </Routes>
            </Shell>
          </BrowserRouter>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
