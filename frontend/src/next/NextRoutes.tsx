import { flushSync } from "react-dom";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import BlankLayout from "@maipai/ui/src/dashboard/layouts/blank/BlankLayout";
import { ThemeProvider } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { useNextLook } from "@/next/useNextLook";
import { useNextAppearance } from "@/next/useNextAppearance";
import { NextPageHeaderTitle } from "@/next/nextPageHeaderTitle";
import { NextDashboardPage } from "@/next/pages/NextDashboardPage";
import { NextChatPage } from "@/next/pages/NextChatPage";
import { NextFamilyPage } from "@/next/pages/NextFamilyPage";
import { NextSettingsPage } from "@/next/pages/NextSettingsPage";
import { NextStoragePage } from "@/next/pages/NextStoragePage";
import { NextEnginesPage } from "@/next/pages/NextEnginesPage";
import { NextPerformancePage } from "@/next/pages/NextPerformancePage";
import { NextUpdatesPage } from "@/next/pages/NextUpdatesPage";
import { NextRepairsPage } from "@/next/pages/NextRepairsPage";
import { NextStatusPage } from "@/next/pages/NextStatusPage";
import { NextBackupsPage } from "@/next/pages/NextBackupsPage";
import { NextVoicesPage } from "@/next/pages/NextVoicesPage";
import { NextCommandsPage } from "@/next/pages/NextCommandsPage";
import { NextDevicesPage } from "@/next/pages/NextDevicesPage";
import { NextPrivacyPage } from "@/next/pages/NextPrivacyPage";
import { NextUsersPage } from "@/next/pages/NextUsersPage";
import { NextModelsPage } from "@/next/pages/NextModelsPage";
import { NextFilesPage } from "@/next/pages/NextFilesPage";
import { NextPersonProfilePage } from "@/next/pages/NextPersonProfilePage";
import { NextSignInPage } from "@/next/pages/NextSignInPage";
import { ChatHeaderDataProvider } from "@/apps/chat/chatHeaderData";
import { api, type Roster } from "@/lib/api";
import { toast } from "sonner";
import { IncognitoProvider, INCOGNITO_DISCARDED_EVENT, useIncognitoContext } from "@/next/incognitoContext";
import { MemoriesRedirect } from "@/shell/MemoriesRedirect";
import { StatusIndicator } from "@/shell/StatusIndicator";
import { BrowserAlerts } from "@/shell/BrowserAlerts";
import { useStatusApps } from "@/shell/useStatusApps";
import { sidebarItemStatus } from "@/shell/statusApps";

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
 * NextChatPage.tsx's own header names what's still a follow-up slice
 * (attachments, suggestions, tools, artifacts, read-aloud).
 *
 * A null person renders `NextSignedOutRoutes` instead of the
 * authenticated tree, including the profile picker at `/sign-in`.
 */
// CHAT-HEADER-02: a sibling of the chat route, never an ancestor of
// it - `NextChatPage.tsx` already owns `HeaderExtraLeft` for its own
// lifetime (`useHeaderExtra(ChatHeaderBar)`), and `useHeaderExtra`'s
// own effect only fires on mount/unmount of its CALLER, not on every
// route change. Nesting this as an ancestor of chat too would race
// the two calls' mount order on navigating into or out of chat,
// sometimes leaving the slot on the wrong component (found designing
// this, not live) - a true sibling route means only one of the two
// is ever mounted for a given `//*` path, so each owns the slot
// cleanly for its own lifetime, the same pattern chat already proves.
function NextPageHeaderLayout() {
  const { pathname } = useLocation();
  useHeaderExtra(NextPageHeaderTitle);
  const titleByPath: Record<string, string> = {
    "/people": "Family",
    "/settings": "Settings",
    "/storage": "Storage",
    "/engines": "Engines",
    "/performance": "Performance",
    "/updates": "Updates",
    "/repairs": "Repairs",
    "/status": "Status",
    "/backups": "Backups",
    "/voices": "Voices",
    "/commands": "Commands",
    "/devices": "Devices",
    "/privacy": "Privacy",
    "/users": "Users",
    "/models": "Models",
    "/files": "Library",
  };
  const title = titleByPath[pathname.replace(/\/$/, "") || "/"];
  return (
    <>
      {title ? <h1 className="sr-only">{title}</h1> : null}
      <Outlet />
    </>
  );
}

// HOME-UI-04d: `useNextAppearance` calls the vendored `useTheme()`, so
// it has to run inside `<ThemeProvider>`, not above it - a small inner
// component rather than inlining the hook call in `NextRoutes` itself,
// which needs to return `<ThemeProvider>` before anything inside it
// can call a hook that reads from it.
function NextRoutesInner({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  useNextAppearance(person.id);
  useNextLook(person.id);

  return (
    <IncognitoProvider>
      <NextRoutesWithIncognito person={person} onPersonChange={onPersonChange} />
    </IncognitoProvider>
  );
}

function NextRoutesWithIncognito({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  const statusAppsQuery = useStatusApps();
  const { on: incognito, setOn: setIncognito } = useIncognitoContext();

  const onIncognitoChange = (on: boolean) => {
    if (on === incognito) return;
    // Mirrors the header's own Light-Dark.tsx toggle (commons ui package):
    // wrap the state flip in a View Transition so Incognito cross-fades
    // the same way light/dark does, instead of the instant repaint every
    // html.incognito-scoped rule in tokens.css would otherwise produce.
    // Falls back to a plain, unanimated flip where the API is unsupported.
    // (TS's DOM lib already types this, unlike Light-Dark.tsx's older
    // `as any` cast for the same call - no cast needed here.) flushSync
    // forces the state update, IncognitoProvider's class-toggling effect,
    // and the commit all the way through before the callback returns -
    // without it, React's async batching can leave the transition's
    // "before" and "after" DOM snapshots identical (a review, twice,
    // caught this: a bare setter call has no such guarantee).
    if (typeof document.startViewTransition === "function") {
      const transition = document.startViewTransition(() => flushSync(() => setIncognito(on)));
      void transition.ready.then(() => {
        document.documentElement.animate(
          { clipPath: ["inset(0 0 100% 0)", "inset(0)"] },
          { duration: 800, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" },
        );
      }).catch(() => {
        // A skipped/aborted transition (e.g. another toggle mid-flight,
        // or a browser honoring reduced-motion) rejects `ready` - the
        // state flip above already applied either way, so there is
        // nothing to recover, just nothing left to animate.
      });
    } else {
      setIncognito(on);
    }
    if (!on) {
      // The state switches the chat adapter immediately; after temporary
      // sessions are discarded, tell the mounted chat runtime to reload
      // once more so its list cannot retain stale Incognito rows.
      void api.discardIncognitoConversations().then(() => {
        window.dispatchEvent(new Event(INCOGNITO_DISCARDED_EVENT));
      }).catch(() => toast.error("Could not discard Incognito chats. Try again."));
    }
  };

  return (
    // CHAT-HEADER-01: wraps every /next page (a Route element, never a
    // per-page one) since FullLayout's own Header - where ChatHeaderBar
    // actually renders (a sibling of this Outlet, not a descendant) -
    // needs the SAME provider instance NextChatPage writes into.
    <ChatHeaderDataProvider>
      <BrowserAlerts person={person} />
      <Routes>
        {/* HOME-UI-02d: the old Memories page now lives on the signed-in
            person's own profile. Preserve both old bookmarks and deep
            links (including ?ids=...) through the existing redirect. */}
        <Route path="memory" element={<MemoriesRedirect selfId={person.id} />} />
        <Route path="memories" element={<MemoriesRedirect selfId={person.id} />} />
        {/* Reachable only while signed out (NextSignedOutRoutes below) -
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
        <Route element={<FullLayout headerSearchRemote={api.search} profileDisplayName={person.display_name} incognito={incognito} onIncognitoChange={onIncognitoChange} showThemeToggle={false} statusIndicator={<StatusIndicator />} sidebarItemStatus={(item) => sidebarItemStatus(statusAppsQuery.data?.apps ?? [], item)} />}>
          <Route path="chat" element={<NextChatPage person={person} />} />
          <Route element={<NextPageHeaderLayout />}>
            <Route index element={<NextDashboardPage person={person} />} />
            <Route path="people" element={<NextFamilyPage person={person} />} />
            <Route path="people/:id" element={<NextPersonProfilePage person={person} onPersonChange={onPersonChange} />} />
            <Route path="settings" element={<NextSettingsPage person={person} onPersonChange={onPersonChange} />} />
            <Route path="storage" element={<NextStoragePage person={person} />} />
            <Route path="engines" element={<NextEnginesPage person={person} />} />
            <Route path="performance" element={<NextPerformancePage />} />
            <Route path="updates" element={<NextUpdatesPage person={person} />} />
            <Route path="repairs" element={<NextRepairsPage person={person} />} />
            <Route path="status" element={<NextStatusPage person={person} />} />
            <Route path="backups" element={<NextBackupsPage person={person} />} />
            <Route path="voices" element={<NextVoicesPage person={person} />} />
            <Route path="commands" element={<NextCommandsPage person={person} />} />
            <Route path="devices" element={<NextDevicesPage />} />
            <Route path="privacy" element={<NextPrivacyPage />} />
            <Route path="users" element={<NextUsersPage person={person} />} />
            <Route path="models" element={<NextModelsPage person={person} />} />
            <Route path="files" element={<NextFilesPage person={person} />} />
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
      <Route path="*" element={<Navigate to="/sign-in" replace />} />
    </Routes>
  );
}

export function NextRoutes({ person, onSignedIn, onPersonChange = () => {} }: { person: Roster | null; onSignedIn: () => void; onPersonChange?: () => void | Promise<void> }) {
  return <ThemeProvider>{person === null ? <NextSignedOutRoutes onSignedIn={onSignedIn} /> : <NextRoutesInner person={person} onPersonChange={onPersonChange} />}</ThemeProvider>;
}
