import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes as RouterRoutes, useLocation } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import BlankLayout from "@maipai/ui/src/dashboard/layouts/blank/BlankLayout";
import { ThemeProvider } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { useLook } from "@/shell/useLook";
import { useAccent } from "@/shell/useAccent";
import { useAppearance } from "@/shell/useAppearance";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { DashboardPage } from "@/shell/pages/DashboardPage";
import { ChatPage } from "@/shell/pages/ChatPage";
import { ProjectsPage } from "@/shell/pages/ProjectsPage";
import { FamilyPage } from "@/shell/pages/FamilyPage";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { CustomizeRedirect, SettingsEntryRedirect } from "@/shell/pages/settings/SettingsEntryRedirect";
import { StoragePage } from "@/shell/pages/StoragePage";
import { PerformancePage } from "@/shell/pages/PerformancePage";
import { TurnTracePage } from "@/shell/pages/TurnTracePage";
import { UpdatesPage } from "@/shell/pages/UpdatesPage";
import { RepairsPage } from "@/shell/pages/RepairsPage";
import { StatusPage } from "@/shell/pages/StatusPage";
import { UiShowcasePage } from "@/shell/pages/UiShowcasePage";
import { BackupsPage } from "@/shell/pages/BackupsPage";
import { CommandsPage } from "@/shell/pages/CommandsPage";
import { meetsMinRole } from "@/apps/people/roles";
import { DevicesPage } from "@/shell/pages/DevicesPage";
import { PrivacyPage } from "@/shell/pages/PrivacyPage";
import { UsersPage } from "@/shell/pages/UsersPage";
import { FilesPage } from "@/shell/pages/FilesPage";
import { PersonProfilePage } from "@/shell/pages/PersonProfilePage";
import { SignInPage } from "@/shell/pages/SignInPage";
import { ChatHeaderDataProvider } from "@/apps/chat/chatHeaderData";
import { discardIncognitoThreads } from "@/apps/chat/chatThreadListAdapter";
import { api, type Roster } from "@/lib/api";
import { toast } from "sonner";
import { IncognitoProvider, INCOGNITO_DISCARDED_EVENT, useIncognitoContext } from "@/shell/incognitoContext";
import { MemoriesRedirect } from "@/shell/MemoriesRedirect";
import { RailProfile } from "@/shell/RailProfile";
import { BrowserAlerts } from "@/shell/BrowserAlerts";
import { useStatusApps } from "@/shell/useStatusApps";
import { sidebarItemStatus } from "@/shell/statusApps";
import { TabIdentityProvider } from "@/shell/tabIdentity";
import { useSessionLocked } from "@/shell/sessionLockContext";
import { activeAppHref, rememberLastAppRoute } from "@/shell/pages/settings/settingsBackLink";
import { retiredManagePageTarget } from "@/shell/pages/settings/settingsRedirects";

/** The migrated root route tree (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md, step 1): mounts the template's
 * FullLayout with Home's sidebar items as data and the template's own
 * views on Home's real data - SHELL-01 and SHELL-03 through SHELL-08
 * have all landed (2026-09-21 to 25); SHELL-02 (`/chat`) is still
 * in progress, see below. The "own demo data" this comment used to say
 * is stale everywhere else, corrected 2026-09-25.
 *
 * `/chat` (CHAT-SDK-01 landed the `@assistant-ui/react@0.15.21`
 * bump the Elements need; SHELL-02 is the wiring, one slice at a
 * time): the Elements thread and composer on Home's existing
 * streaming adapter, real turns, reply text and reasoning rendering
 * (slice 1), joined by the thread list and history (slice 2).
 * ChatPage.tsx's own header names what's still a follow-up slice
 * (attachments, suggestions, tools, artifacts, read-aloud).
 *
 * A null person renders `SignedOutRoutes` instead of the
 * authenticated tree, including the profile picker at `/sign-in`.
 */
// CHAT-HEADER-02: a sibling of the chat route, never an ancestor of
// it - `ChatPage.tsx` already owns `HeaderExtraLeft` for its own
// lifetime (`useHeaderExtra(ChatHeaderBar)`), and `useHeaderExtra`'s
// own effect only fires on mount/unmount of its CALLER, not on every
// route change. Nesting this as an ancestor of chat too would race
// the two calls' mount order on navigating into or out of chat,
// sometimes leaving the slot on the wrong component (found designing
// this, not live) - a true sibling route means only one of the two
// is ever mounted for a given `//*` path, so each owns the slot
// cleanly for its own lifetime, the same pattern chat already proves.
function PageHeaderLayout() {
  const { pathname } = useLocation();
  useHeaderExtra(PageHeaderTitle);
  const titleByPath: Record<string, string> = {
    "/people": "Family",
    "/storage": "Storage",
    "/performance": "Performance",
    "/updates": "Updates",
    "/repairs": "Repairs",
    "/status": "Status",
    "/backups": "Backups",
    "/commands": "Commands",
    "/devices": "Devices",
    "/privacy": "Privacy",
    "/users": "Users",
    "/files": "Library",
    "/dev/ui": "Chat showcase",
  };
  const title = titleByPath[pathname.replace(/\/$/, "") || "/"];
  return (
    <>
      {title ? <h1 className="sr-only">{title}</h1> : null}
      <Outlet />
    </>
  );
}

// HOME-UI-04d: `useAppearance` calls the vendored `useTheme()`, so
// it has to run inside `<ThemeProvider>`, not above it - a small inner
// component rather than inlining the hook call in `Routes` itself,
// which needs to return `<ThemeProvider>` before anything inside it
// can call a hook that reads from it.
function RoutesInner({ person, onPersonChange, onSignedOut }: { person: Roster; onPersonChange: () => void | Promise<void>; onSignedOut: () => void }) {
  useAppearance(person.id);
  useLook(person.id);
  useAccent(person.accent);

  return (
    <IncognitoProvider>
      <RoutesWithIncognito person={person} onPersonChange={onPersonChange} onSignedOut={onSignedOut} />
    </IncognitoProvider>
  );
}

function RoutesWithIncognito({ person, onPersonChange, onSignedOut }: { person: Roster; onPersonChange: () => void | Promise<void>; onSignedOut: () => void }) {
  const location = useLocation();
  const selectedAppHref = activeAppHref(location.pathname);
  const statusAppsQuery = useStatusApps();
  const { on: incognito, setOn: setIncognito } = useIncognitoContext();
  const locked = useSessionLocked();

  useEffect(() => {
    rememberLastAppRoute(`${location.pathname}${location.search}${location.hash}`);
  }, [location.pathname, location.search, location.hash]);

  const onIncognitoChange = (on: boolean) => {
    if (on === incognito) return;
    // INCOGNITO-ANIM-01 (owner, 2026-10-06): the 800 ms wipe was scary.
    // Like ChatGPT's temporary chat there is no transition: the state flips
    // at once, and the label and frame arrive with it.
    setIncognito(on);
    if (!on) {
      // The state switches the chat adapter immediately; after temporary
      // sessions are discarded, tell the mounted chat runtime to reload
      // once more so its list cannot retain stale Incognito rows.
      void discardIncognitoThreads().then(() => {
        window.dispatchEvent(new Event(INCOGNITO_DISCARDED_EVENT));
      }).catch(() => toast.error("Could not discard Incognito chats. Try again."));
    }
  };

  return (
    // CHAT-HEADER-01: wraps each root app page (a Route element, never a
    // per-page one) since FullLayout's own Header - where ChatHeaderBar
    // actually renders (a sibling of this Outlet, not a descendant) -
    // needs the SAME provider instance ChatPage writes into.
    <TabIdentityProvider temporary={incognito} locked={locked} ageBand={person.age_band}>
    <ChatHeaderDataProvider>
      <BrowserAlerts person={person} />
      <RouterRoutes>
        {/* HOME-UI-02d: the old Memories page now lives on the signed-in
            person's own profile. Preserve both old bookmarks and deep
            links (including ?ids=...) through the existing redirect. */}
        <Route path="memory" element={<MemoriesRedirect selfId={person.id} />} />
        <Route path="memories" element={<MemoriesRedirect selfId={person.id} />} />
        {/* Reachable only while signed out (SignedOutRoutes below) -
            an already-authenticated visit to this URL has nothing to do
            here, so it bounces to the dashboard instead of a blank
            no-match. */}
        <Route path="sign-in" element={<Navigate to="/" replace />} />
        {/* SHELL-SEARCH-02: api.search, home's own header wiring for the
            kit's HeaderSearch remote prop (FullLayout -> Header ->
            HeaderSearch, a plain prop threaded down since FullLayout is
            the one component this file actually instantiates itself). */}
        {/* THEME-TOGGLE-01 (2026-09-26): light/dark already lives at
            Settings > Me > Appearance (ui.appearance) - the header's
            own shortcut duplicated it, so it's off here. */}
        {/* RAIL-01 (owner's layout, 2026-10-06; design rule S1): the
            permanent 56px app rail. Search sits at its top, the apps below,
            and the profile at its bottom opens the one menu that holds
            Notifications, System status, Incognito, Settings, Help and Log
            out. Pages draw their own slim title bar; chat draws its own
            beside the history column. */}
        <Route element={<FullLayout rail activeAppHref={selectedAppHref} headerSearchRemote={api.search} railProfile={<RailProfile person={person} incognito={incognito} onIncognitoChange={onIncognitoChange} onSignedOut={onSignedOut} />} sidebarItemStatus={(item) => sidebarItemStatus(statusAppsQuery.data ?? [], item)} />}>
          <Route path="chat" element={<ChatPage person={person} />} />
          <Route path="chat/projects" element={<ProjectsPage person={person} />} />
          <Route path="chat/projects/:id" element={<ChatPage person={person} />} />
          {/* APP-SET-02 (RULES S4): the settings areas draw no slim title bar,
              like ChatGPT's own settings page: the column title is the page's
              heading, so these routes sit beside chat, outside
              PageHeaderLayout. `/settings` and every old `?tab=` link
              replace to the page that holds them now; `/customize` is gone. */}
          <Route path="settings" element={<SettingsEntryRedirect person={person} />} />
          <Route path="settings/:area/:section?" element={<SettingsAreaPage person={person} onPersonChange={onPersonChange} />} />
          {/* ENGINES-AI-01: the Manage pages that moved into Home settings are links that land on their section. */}
          {["voices", "engines", "models"].map((path) => (
            <Route key={path} path={path} element={<Navigate to={retiredManagePageTarget(`/${path}`, { canManageHousehold: meetsMinRole(person.role, "admin") }) ?? "/settings/account"} replace />} />
          ))}
          <Route path="customize" element={<CustomizeRedirect person={person} />} />
          <Route element={<PageHeaderLayout />}>
            <Route index element={<DashboardPage person={person} />} />
            <Route path="people" element={<FamilyPage person={person} />} />
            <Route path="people/:id" element={<PersonProfilePage person={person} onPersonChange={onPersonChange} />} />
            <Route path="storage" element={<StoragePage person={person} />} />
            <Route path="performance" element={<PerformancePage />} />
            <Route path="trace/:turnId" element={<TurnTracePage />} />
            <Route path="updates" element={<UpdatesPage person={person} />} />
            <Route path="repairs" element={<RepairsPage person={person} />} />
            <Route path="status" element={<StatusPage person={person} />} />
            <Route path="backups" element={<BackupsPage person={person} />} />
            <Route path="commands" element={meetsMinRole(person.role, "adult") ? <CommandsPage person={person} /> : <Navigate to="/settings/account" replace />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="users" element={<UsersPage person={person} />} />
            <Route path="files" element={<FilesPage person={person} />} />
            <Route path="dev/ui" element={<UiShowcasePage person={person} />} />
          </Route>
        </Route>
      </RouterRoutes>
    </ChatHeaderDataProvider>
    </TabIdentityProvider>
  );
}

function SignedOutRoutes({ onSignedIn }: { onSignedIn: () => void }) {
  return (
    <RouterRoutes>
      <Route path="sign-in" element={<BlankLayout />}>
        <Route index element={<SignInPage onSignedIn={onSignedIn} />} />
      </Route>
      {/* Any other /* path while signed out (including bare
          the preview route lands on the sign-in screen, not a blank no-match -
          the same "nothing renders before someone is signed in"
          posture the old shell's own SignIn.tsx documents. */}
      <Route path="*" element={<Navigate to="/sign-in" replace />} />
    </RouterRoutes>
  );
}

export function Routes({ person, onSignedIn, onPersonChange = () => {} }: { person: Roster | null; onSignedIn: () => void; onPersonChange?: () => void | Promise<void> }) {
  return <ThemeProvider>{person === null ? <SignedOutRoutes onSignedIn={onSignedIn} /> : <RoutesInner person={person} onPersonChange={onPersonChange} onSignedOut={onSignedIn} />}</ThemeProvider>;
}
