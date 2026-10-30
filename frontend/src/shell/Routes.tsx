import { useQuery } from "@tanstack/react-query";
import { HeaderSearchOptionsContext } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderSearch";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DrawerSectionsContext } from "@/shell/drawerSections";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";
import { Navigate, Outlet, Route, Routes as RouterRoutes, useLocation, useMatch, useNavigate, useParams } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import BlankLayout from "@maipai/ui/src/dashboard/layouts/blank/BlankLayout";
import { ThemeProvider } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { useLook } from "@/shell/useLook";
import { useEase } from "@/shell/useEase";
import { useAccent } from "@/shell/useAccent";
import { useAppearance } from "@/shell/useAppearance";
import { PageHeaderActions, PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { DashboardPage } from "@/shell/pages/DashboardPage";
import { ChatPage } from "@/shell/pages/ChatPage";
import { ALL_APPS_PATH } from "@/shell/allAppsPath";
import { PhoneMenuLinks, searchWithCoreApps } from "@/shell/phoneMenuLinks";
import { CustomizeRedirect, LegacySettingsRedirect, SettingsEntryRedirect } from "@/shell/pages/settings/SettingsEntryRedirect";
import { meetsMinRole } from "@/apps/people/roles";
import { SignInPage } from "@/shell/pages/SignInPage";
import { ChatHeaderDataProvider } from "@/apps/chat/chatHeaderData";
import { discardIncognitoThreads } from "@/apps/chat/chatThreadListAdapter";
import { api, type Roster } from "@/lib/api";
import { toast } from "sonner";
import { AudioSessionProvider } from "@/shell/audioSessionContext";
import { MediaHostProvider, MediaLinkRedirect } from "@/shell/mediaHost";
import { GlobalMiniPlayer } from "@/shell/GlobalMiniPlayer";
import { IncognitoProvider, INCOGNITO_DISCARDED_EVENT, useIncognitoContext } from "@/shell/incognitoContext";
import { MemoriesRedirect, LegacyProfileMemoriesRedirect } from "@/shell/MemoriesRedirect";
import { InstallDock } from "@/shell/InstallDock";
import { CompanionPreview } from "@maipai/ui/src/elements/companion-preview";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { CompanionAvatar } from "@maipai/ui/src/elements/companion-avatar";
import { Avatar, AvatarImage } from "@maipai/ui/src/elements/ui/avatar";
import { Avatar as SeededAvatar } from "@maipai/ui/src/primitives/Avatar";
import { Button } from "@maipai/ui/src/elements/ui/button";
import { useAmbientCompanion } from "@/shell/useAmbientCompanion";
import { AmbientRingProvider, ambientRingFromWake, effectiveAmbientRing, type AmbientRing, type AmbientWakeIndicator } from "@/shell/ambientRing";
import { ChatAvailabilityContext, useChatAvailability } from "@/apps/chat/useChatAvailability";
import { RailProfile } from "@/shell/RailProfile";
import { BrowserAlerts } from "@/shell/BrowserAlerts";
import { AlarmRinger } from "@/shell/AlarmRinger";
import { useWakeWordListening } from "@/apps/chat/useWakeWordListening";
import { LauncherBubble } from "@maipai/ui/src/elements/launcher-bubble";
import { useStatusApps } from "@/shell/useStatusApps";
import { railApps } from "@/shell/appCatalog";
import { useAppCatalog } from "@/shell/useAppCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { sidebarItemStatus } from "@/shell/statusApps";
import { TabIdentityProvider } from "@/shell/tabIdentity";
import { useSessionLocked } from "@/shell/sessionLockContext";
import { packageAreaApps, usePackageAreas } from "@/shell/pages/settings/packageAreas";
import { activeAppHref, rememberLastAppRoute } from "@/shell/pages/settings/settingsBackLink";
import { retiredManagePageTarget } from "@/shell/pages/settings/settingsRedirects";
import { lazyNamed } from "@/shell/lazyNamed";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { Tour } from "@maipai/ui/src/primitives/Tour";
import { useTourRunner } from "@/shell/useTourRunner";
import { CompanionShellViewer } from "@/lib/companionShells";
import { RightPane } from "@maipai/ui/src/elements/right-pane";
import { useAmbientCompanionPane, readAmbientPaneState, type AmbientPaneControl, type AmbientPaneState } from "@/shell/AmbientCompanionPane";
import { useSideChat } from "@/shell/useSideChat";
import { AmbientHeaderProvider } from "@/shell/ambientHeaderContext";
import { AmbientPageContextProvider, ambientPageContextForRoute } from "@/shell/pageContext";

// BUNDLE-SPLIT-01 (2026-10-17): every page but the two a person lands on (Home and Chat) loads on first visit, not
// with the shell. The shell chunk had grown to 3.84 MB against the 4 MiB PWA precache ceiling; the pages below hold
// charts, the media player, the settings libraries and the profile editors, which most visits never open.
const FamilyPage = lazyNamed(() => import("@/shell/pages/FamilyPage"), "FamilyPage");
const CompanionsPage = lazyNamed(() => import("@/shell/pages/CompanionsPage"), "CompanionsPage");
const CompanionDetailPage = lazyNamed(() => import("@/shell/pages/CompanionsPage"), "CompanionDetailPage");
const CompanionFlowPage = lazyNamed(() => import("@/shell/pages/companionFlow/CompanionFlowPage"), "CompanionFlowPage");
const ProjectsPage = lazyNamed(() => import("@/shell/pages/ProjectsPage"), "ProjectsPage");
const PersonProfilePage = lazyNamed(() => import("@/shell/pages/PersonProfilePage"), "PersonProfilePage");
const StoragePage = lazyNamed(() => import("@/shell/pages/StoragePage"), "StoragePage");
const TrashPage = lazyNamed(() => import("@/shell/pages/TrashPage"), "TrashPage");
const PerformancePage = lazyNamed(() => import("@/shell/pages/PerformancePage"), "PerformancePage");
const TurnTracePage = lazyNamed(() => import("@/shell/pages/TurnTracePage"), "TurnTracePage");
const UpdatesPage = lazyNamed(() => import("@/shell/pages/UpdatesPage"), "UpdatesPage");
const RepairsPage = lazyNamed(() => import("@/shell/pages/RepairsPage"), "RepairsPage");
const StatusPage = lazyNamed(() => import("@/shell/pages/StatusPage"), "StatusPage");
const UiShowcasePage = lazyNamed(() => import("@/shell/pages/UiShowcasePage"), "UiShowcasePage");
const BackupsPage = lazyNamed(() => import("@/shell/pages/BackupsPage"), "BackupsPage");
const CommandsPage = lazyNamed(() => import("@/shell/pages/CommandsPage"), "CommandsPage");
const PrivacyPage = lazyNamed(() => import("@/shell/pages/PrivacyPage"), "PrivacyPage");
const UsersPage = lazyNamed(() => import("@/shell/pages/UsersPage"), "UsersPage");
const FilesPage = lazyNamed(() => import("@/shell/pages/FilesPage"), "FilesPage");
const ReferencePage = lazyNamed(() => import("@/shell/pages/ReferencePage"), "ReferencePage");
const WikipediaPage = lazyNamed(() => import("@/shell/pages/WikipediaPage"), "WikipediaPage");
const NewsDiscussPage = lazyNamed(() => import("@/shell/pages/NewsDiscussPage"), "NewsDiscussPage");
const PackageAppPage = lazyNamed(() => import("@/shell/pages/PackageAppPage"), "PackageAppPage");
const MediaHomePage = lazyNamed(() => import("@/shell/pages/MediaHomePage"), "MediaHomePage");
const MediaSearchPage = lazyNamed(() => import("@/shell/pages/MediaSearchPage"), "MediaSearchPage");
const AllAppsPage = lazyNamed(() => import("@/shell/pages/AllAppsPage"), "AllAppsPage");
const MicTestPage = lazyNamed(() => import("@/shell/pages/MicTestPage"), "MicTestPage");
const SettingsAreaPage = lazyNamed(() => import("@/shell/pages/settings/SettingsAreaPage"), "SettingsAreaPage");
const SetupReviewPage = lazyNamed(() => import("@/apps/setup/SetupReviewPage"), "SetupReviewPage");

// NOTIF-ROUTE-01: the thirty-day history page, reached from the bell's
// "View history" link and the phone header's bell. Lazy so it stays out
// of the first bundle, as it was before 6bed798c dropped the route.
// MEDIA-POLISH-01: package app pages load on demand. They carry the schema interpreter, the kit Player and Media Chrome, which pushed
// the Routes chunk past the 4 MiB service-worker precache ceiling (vite.config.ts, src/apps/setup/preview/bundle.test.ts).
const NotificationsPage = lazy(() => import("@/apps/notifications/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const RemindersPage = lazy(() => import("@/apps/reminders/RemindersPage").then((m) => ({ default: m.RemindersPage })));
const ClockPage = lazy(() => import("@/apps/clock/ClockPage").then((m) => ({ default: m.ClockPage })));

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
  useHeaderExtra(PageHeaderTitle, PageHeaderActions);
  const titleByPath: Record<string, string> = {
    "/people": "Family",
    "/storage": "Storage",
    "/performance": "Performance",
    "/updates": "Updates",
    "/repairs": "Repairs",
    "/status": "Status",
    "/backups": "Backups",
    "/commands": "Commands",
    "/privacy": "Privacy",
    "/users": "Users",
    "/reference": "Reference",
    "/dev/ui": "Chat showcase",
  };
  const title = titleByPath[pathname.replace(/\/$/, "") || "/"];
  return (
    <>
      {title ? <h1 className="sr-only">{title}</h1> : null}
      <Suspense fallback={<RouteSkeleton />}><Outlet /></Suspense>
    </>
  );
}

/** The one install line, pinned to the bottom of every page for everyone signed in. Admins and the owner can
 * open it for details; the Home settings AI page already shows its own copy. */
function ShellInstallStrip({ person }: { person: Roster }) {
  const { pathname } = useLocation();
  if (pathname === "/settings/ai") return null;
  return <InstallDock admin={meetsMinRole(person.role, "admin")} />;
}

// HOME-UI-04d: `useAppearance` calls the vendored `useTheme()`, so
// it has to run inside `<ThemeProvider>`, not above it - a small inner
// component rather than inlining the hook call in `Routes` itself,
// which needs to return `<ThemeProvider>` before anything inside it
// can call a hook that reads from it.
function RoutesInner({ person, onPersonChange, onSignedOut }: { person: Roster; onPersonChange: () => void | Promise<void>; onSignedOut: () => void }) {
  const location = useLocation();
  const appCatalog = useAppCatalog();
  // The kit's phone layouts keep one column and the larger kid targets for a child (docs/design/phone-minimal-2026-10-25.md P4a):
  // the page says whose band it is, the kit's CSS reads it.
  useEffect(() => {
    document.documentElement.dataset.ageBand = person.age_band;
    return () => { delete document.documentElement.dataset.ageBand; };
  }, [person.age_band]);
  useAppearance(person.id);
  useLook(person.id);
  useEase(person.id);
  useAccent(person.accent);

  const pageContext = ambientPageContextForRoute(location.pathname, appCatalog);
  return (
    <AudioSessionProvider personId={person.id}>
      <MediaHostProvider>
        <IncognitoProvider>
          <AmbientPageContextProvider base={pageContext}>
            <RoutesWithIncognito person={person} onPersonChange={onPersonChange} onSignedOut={onSignedOut} appCatalog={appCatalog} />
          </AmbientPageContextProvider>
        </IncognitoProvider>
      </MediaHostProvider>
    </AudioSessionProvider>
  );
}

function RoutesWithIncognito({ person, onPersonChange, onSignedOut, appCatalog }: { person: Roster; onPersonChange: () => void | Promise<void>; onSignedOut: () => void; appCatalog: ReturnType<typeof useAppCatalog> }) {
  const location = useLocation();
  // WAKEUX-02: ChatPage listens for the word itself (it owns the call); on every other page this does, and Chat opens with the call running.
  const navigate = useNavigate();
  const chatMatch = useMatch("/chat");
  const projectChatMatch = useMatch("/chat/projects/:id");
  const onChatPage = chatMatch !== null || projectChatMatch !== null;
  const ambient = useAmbientCompanion(person);
  const [ring, setRing] = useState<AmbientRing>(null);
  const [wakeIndicator, setWakeIndicator] = useState<AmbientWakeIndicator>(null);
  const selectedAppHref = activeAppHref(location.pathname, packageAreaApps(usePackageAreas().areas));
  const statusAppsQuery = useStatusApps();
  // LEFTNAV-APPS-01: the installed package apps this person may open (the hub's list, minus an Incognito-blocked app
  // while Incognito is on), pinned ones in the rail and all of them in the launcher at its foot.
  const { on: incognito, setOn: setIncognito } = useIncognitoContext();
  const chatAvailability = useChatAvailability();
  const [coarse, setCoarse] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [paneState, setPaneState] = useState(readAmbientPaneState);
  const paneControlRef = useRef<AmbientPaneControl | null>(null);
  const [paneRing, setPaneRing] = useState<AmbientRing>(null);
  const [lastLine, setLastLine] = useState("");
  const paneOpenRef = useRef(paneState.open);
  paneOpenRef.current = paneState.open;
  const onSideReply = useCallback((text: string) => {
    if (paneOpenRef.current || !text.trim()) return;
    setLastLine(text.split(/(?<=[.!?])\s+/).filter(Boolean).at(-1) ?? text.trim());
  }, []);
  const onPaneRing = useCallback((next: AmbientRing | undefined) => setPaneRing(next ?? null), []);
  const sideChat = useSideChat(person, ambient?.companion.id ?? "", incognito, onSideReply);
  const updatePaneState = (next: AmbientPaneState) => {
    setPaneState(next);
    try { window.localStorage.setItem("maipai.ambient.pane", JSON.stringify(next)); } catch { /* local storage may be unavailable */ }
    if (next.open) { setLastLine(""); setPreviewOpen(false); }
  };
  const openChatWithCall = useCallback(() => {
    if (!ambient) { navigate("/chat?wake=1"); return; }
    updatePaneState({ ...paneState, open: true });
    paneControlRef.current?.startCall();
  }, [ambient, navigate, paneState]);
  const shellWake = useWakeWordListening({ person, onWake: openChatWithCall, active: !onChatPage, voiceOpen: sideChat.callActive });
  const shellListeningLine = shellWake.indicator?.listening;
  const shellTurnOff = shellWake.indicator?.onTurnOff;
  useEffect(() => {
    if (!lastLine || paneState.open) return;
    setPreviewOpen(true);
    const timer = window.setTimeout(() => { setPreviewOpen(false); setLastLine(""); }, 6000);
    return () => window.clearTimeout(timer);
  }, [lastLine, paneState.open]);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const media = matchMedia("(pointer: coarse)");
    const update = () => setCoarse(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    if (shellListeningLine && shellTurnOff) setWakeIndicator({ listening: shellListeningLine, onTurnOff: shellTurnOff });
    else if (!onChatPage) setWakeIndicator(null);
  }, [shellListeningLine, shellTurnOff, onChatPage]);
  useEffect(() => { if (coarse && wakeIndicator) setPreviewOpen(true); }, [coarse, wakeIndicator]);
  const effectiveRing = effectiveAmbientRing(paneRing, ring, ambientRingFromWake(shellListeningLine ? { listening: shellListeningLine } : null));
  const currentApp = appCatalog.find((app) => location.pathname === app.to || location.pathname.startsWith(`${app.to}/`));
  const appName = currentApp?.label ?? (location.pathname === "/" ? "Home" : undefined);
  const ambientTrigger = ambient ? <button type="button" className="flex size-12 items-center justify-center" aria-label={wakeIndicator?.listening.startsWith("Listening for") ? `${ambient.companion.name}, listening` : ambient.companion.name} onClick={() => {
    if (coarse && wakeIndicator) { setPreviewOpen((value) => !value); return; }
    updatePaneState({ ...paneState, open: true });
  }}>
    {ambient.clips ? <CompanionAvatar name={ambient.companion.name} clips={ambient.portrait ? { idle: { still: ambient.portrait, loop: true } } as never : ambient.clips} size="header" animated={false} ring={effectiveRing ?? "idle"} /> : ambient.still ? <Avatar><AvatarImage src={ambient.still} alt="" /></Avatar> : <SeededAvatar name={ambient.companion.name} seed={ambient.companion.id} />}
  </button> : null;
  const ambientTopRight = ambient ? <CompanionPreview
    name={ambient.companion.name}
    trigger={ambientTrigger}
    ready={chatAvailability === "ready"}
    context={appName ? `You're on ${appName}` : undefined}
    lastLine={lastLine || undefined}
    askPlaceholder={`Ask ${ambient.companion.name}`}
    onAsk={(text) => {
      paneControlRef.current?.ask(text);
    }}
    action={ambient.action ? <Button type="button" onClick={ambient.action.onClick}>{ambient.action.label}</Button> : undefined}
    listeningLine={wakeIndicator?.listening}
    onTurnOff={wakeIndicator?.onTurnOff}
    open={lastLine ? previewOpen : coarse ? (wakeIndicator ? true : previewOpen) : undefined}
    onOpenChange={setPreviewOpen}
  /> : undefined;
  const ambientAvatar = ambient ? <button type="button" className="flex size-12 items-center justify-center" aria-label={ambient.companion.name} onClick={() => { updatePaneState({ ...paneState, open: true }); }}>
    {ambient.clips ? <CompanionAvatar name={ambient.companion.name} clips={ambient.portrait ? { idle: { still: ambient.portrait, loop: true } } as never : ambient.clips} size="header" animated={false} ring={effectiveRing ?? "idle"} /> : ambient.still ? <Avatar><AvatarImage src={ambient.still} alt="" /></Avatar> : <SeededAvatar name={ambient.companion.name} seed={ambient.companion.id} />}
  </button> : null;
  const ambientPaneProps = useAmbientCompanionPane({
    person, companionName: ambient?.companion.name ?? "Companion", companionId: ambient?.companion.id ?? "",
    avatar: ambientAvatar, clips: ambient?.clips, still: ambient?.still, incognito, state: paneState, onStateChange: updatePaneState,
    onRing: onPaneRing, wake: wakeIndicator,
    onContinue: (id) => { if (id) navigate(`/chat?conversation=${encodeURIComponent(id)}`); },
    side: sideChat,
  });
  paneControlRef.current = ambientPaneProps.control;
  // SEARCH-MODERN-04: the palette's empty query lists the person's own recent chats (the same actor-scoped list the chat
  // sidebar reads, nothing stored locally), and its "Ask" row sends the typed text to the companion as an ordinary message.
  const recentChats = useQuery({ queryKey: ["search-recents"], queryFn: () => api.conversationList(), staleTime: 60_000, enabled: !incognito });
  const headerSearchOptions = useMemo(() => ({
    recents: (Array.isArray(recentChats.data) ? recentChats.data : []).slice(0, 5).map((c) => ({ kind: "conversation", id: c.id, title: c.title ?? "New Chat", href: `/chat?conversation=${encodeURIComponent(c.id)}` })),
    onAsk: ambient ? (text: string) => paneControlRef.current?.ask(text) : undefined,
    // WEB-TAB-03: the Web tab, for everyone but a guest; the server applies the household's sources and the age rules.
    webSearch: person.role === "guest" ? undefined : (text: string) => api.searchWebResults(text),
  }), [recentChats.data, ambient, person.role]);
  const ambientRightPane = ambient ? <RightPane {...ambientPaneProps} /> : undefined;
  const { pinned: pinnedRoutes, togglePin } = usePinnedApps(person.id);
  const locked = useSessionLocked();
  // The phone menu drawer's section list for the page that is open (a page with a section column sets it).
  const [drawerSections, setDrawerSections] = useState<ReactNode>(null);
  const tourRunner = useTourRunner(person);
  const activeTour = tourRunner.active;
  const helpEntries = tourRunner.availableTours.length
    ? {
        label: "Show me around",
        items: tourRunner.availableTours.map(({ packageId, tour }) => ({
          label: tour.title,
          onSelect: () => { tourRunner.replay(packageId, tour.id); },
        })),
      }
    : undefined;

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
    <CompanionShellViewer.Provider value={person}>
    <DrawerSectionsContext.Provider value={setDrawerSections}>
    <TabIdentityProvider temporary={incognito} locked={locked} ageBand={person.age_band}>
    <ChatHeaderDataProvider>
      <BrowserAlerts person={person} />
      <AlarmRinger person={person} />
      {/* When ambient mode is off, keep the docked launcher here; moving it to the top right is a later slice. */}
      {shellWake.indicator && !ambient ? <LauncherBubble docked open={false} unread={0} greeting="" prompts={[]} {...shellWake.indicator} /> : null}
      <ShellInstallStrip person={person} />
      <GlobalMiniPlayer />
      {activeTour ? (
        <Tour
          steps={activeTour.tour.steps.map((step) => ({
            target: step.target ? `[${["data", "tour"].join("-")}="${CSS.escape(step.target)}"]` : undefined,
            title: (person.age_band && person.age_band !== "adult" ? step.title_by_audience?.[person.age_band] : undefined) ?? step.title ?? activeTour.tour.title,
            body: (person.age_band && person.age_band !== "adult" ? step.body_by_audience?.[person.age_band] : undefined) ?? step.body ?? "",
            placement: step.placement,
          }))}
          onFinish={() => activeTour.progress("completed", activeTour.tour.steps.at(-1)?.id)}
          onSkip={() => activeTour.progress("skipped")}
          onTargetMissing={activeTour.missing}
        />
      ) : null}
      <ChatAvailabilityContext.Provider value={chatAvailability}>
      <AmbientRingProvider value={ring} onChange={setRing} wake={wakeIndicator} onWakeChange={setWakeIndicator}>
      <AmbientHeaderProvider value={paneState.open || onChatPage ? null : ambientTopRight}>
      <WakeWordPersonContext.Provider value={person}>
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
        <Route element={<HeaderSearchOptionsContext.Provider value={headerSearchOptions}><FullLayout rail topRight={paneState.open ? undefined : ambientTopRight} topRightBand fallbackTitle={location.pathname.startsWith("/settings") ? "Settings" : appName ?? (location.pathname === "/" ? "Home" : undefined)} rightPane={ambientRightPane} mobileSections={<>{drawerSections}<div className="mt-3 border-t border-border pt-3"><PhoneMenuLinks /></div></>} activeAppHref={selectedAppHref} railApps={railApps(appCatalog, pinnedRoutes)} railCoreDestinations={[{ name: "Media", url: "/media", icon: "cast" }, { name: "Reminders", url: "/reminders", icon: "layout-list" }, { name: "Clock", url: "/clock", icon: "clock" }]} onRailAppPinChange={(url) => togglePin(url)} railAllAppsHref={ALL_APPS_PATH} settingsHref="/settings" headerSearchRemote={(query) => searchWithCoreApps(query, appCatalog)} railTourId="shell.rail" railItemTourId={(item) => item.name === "Chat" ? "rail.chat" : undefined} incognitoTourId="shell.incognito" railProfile={<RailProfile person={person} incognito={incognito} onIncognitoChange={onIncognitoChange} onSignedOut={onSignedOut} helpEntries={helpEntries} />} sidebarItemStatus={(item) => sidebarItemStatus(statusAppsQuery.data ?? [], item)} /></HeaderSearchOptionsContext.Provider>}>
          <Route path="chat" element={<ChatPage person={person} />} />
          <Route path="chat/projects" element={<ProjectsPage person={person} />} />
          <Route path="chat/projects/:id" element={<ChatPage person={person} />} />
          {/* Like Chat, Library owns its page header and leaves FullLayout's phone menu clearance intact. */}
          <Route path="files" element={<FilesPage person={person} />} />
          <Route path="media" element={<MediaHomePage />} />
          <Route path="media/search" element={<MediaSearchPage />} />
          {/* APP-SET-02 (RULES S4): the settings areas draw no slim title bar,
              like ChatGPT's own settings page: the column title is the page's
              heading, so these routes sit beside chat, outside
              PageHeaderLayout. `/settings` and every old `?tab=` link
              replace to the page that holds them now; `/customize` is gone. */}
          <Route path="storage/trash" element={<TrashPage person={person} />} />
          <Route path="settings" element={<SettingsEntryRedirect person={person} />} />
          <Route path="settings/home/robot/:robotId" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/home" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/account" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/home/:legacySection" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/account/:legacySection" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/chat/:legacySection" element={<LegacySettingsRedirect person={person} />} />
          <Route path="settings/:section?/:detailId?" element={<Suspense fallback={<RouteSkeleton />}><SettingsAreaPage person={person} onPersonChange={onPersonChange} /></Suspense>} />
          {/* ENGINES-AI-01: the Manage pages that moved into Home settings are links that land on their section. */}
          {["voices", "engines", "models", "devices"].map((path) => (
            <Route key={path} path={path} element={<Navigate to={retiredManagePageTarget(`/${path}`, { canManageHousehold: meetsMinRole(person.role, "admin") }) ?? "/settings/profile"} replace />} />
          ))}
          <Route path="customize" element={<CustomizeRedirect person={person} />} />
          {/* APP-KIND-04: every installed package app, with no rebuild. Static routes win over this splat.
              MEDIA-POLISH-01 (RULES S2): an app draws its own header, so app pages sit outside PageHeaderLayout, whose
              title bar had no entry for them and drew an empty 52 px strip above every app. */}
          <Route path="apps/news/discuss" element={<Suspense fallback={null}><NewsDiscussPage person={person} /></Suspense>} />
          <Route path="apps/*" element={<Suspense fallback={null}><PackageAppPage person={person} /></Suspense>} />
          <Route element={<PageHeaderLayout />}>
            <Route index element={<DashboardPage person={person} />} />
            <Route path="companions" element={<CompanionsPage />} />
            <Route path="companions/create" element={<CompanionFlowPage />} />
            <Route path="companions/:id/create" element={<CompanionFlowPage />} />
            <Route path="companions/start" element={<Navigate to="/companions/create" replace />} />
            <Route path="companions/new" element={<Navigate to="/companions/create" replace />} />
            <Route path="companions/:id/edit" element={<CompanionEditRedirect />} />
            <Route path="companions/:id" element={<CompanionDetailPage />} />
            <Route path="people" element={<FamilyPage person={person} />} />
            <Route path="people/:id" element={location.search.includes("tab=memories") ? <LegacyProfileMemoriesRedirect selfId={person.id} /> : <PersonProfilePage person={person} onPersonChange={onPersonChange} />} />
            <Route path="storage" element={<StoragePage person={person} />} />
            <Route path="performance" element={<PerformancePage />} />
            <Route path="trace/:turnId" element={<TurnTracePage />} />
            <Route path="updates" element={<UpdatesPage person={person} />} />
            <Route path="repairs" element={<RepairsPage person={person} />} />
            <Route path="setup/review" element={meetsMinRole(person.role, "admin") ? <SetupReviewPage /> : <Navigate to="/" replace />} />
            <Route path="status" element={<StatusPage person={person} />} />
            <Route path="backups" element={<BackupsPage person={person} />} />
            <Route path="commands" element={meetsMinRole(person.role, "adult") ? <CommandsPage person={person} /> : <Navigate to="/settings/chat" replace />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="users" element={<UsersPage person={person} />} />
            <Route path="reference/*" element={<ReferencePage />} />
            <Route path="wikipedia/*" element={<WikipediaPage />} />
            <Route path="all-apps" element={<AllAppsPage person={person} />} />
            {/* MEDIA-VIDEOS-01: the Pick up shelf's `/media/<id>` link opens the item in the app that owns its kind. */}
            <Route path="media/:id" element={<MediaLinkRedirect />} />
            <Route path="notifications" element={<Suspense fallback={null}><NotificationsPage /></Suspense>} />
            <Route path="household" element={<Navigate to="/reminders" replace />} />
            <Route path="household/coming-up" element={<Navigate to="/reminders" replace />} />
            <Route path="reminders" element={<Suspense fallback={null}><RemindersPage /></Suspense>} />
            <Route path="reminders/coming-up" element={<Navigate to="/reminders" replace />} />
            <Route path="clock" element={<Suspense fallback={null}><ClockPage /></Suspense>} />
            <Route path="dev/ui" element={<UiShowcasePage person={person} />} />
            <Route path="mic-test" element={<MicTestPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </RouterRoutes>
      </WakeWordPersonContext.Provider>
      </AmbientHeaderProvider>
      </AmbientRingProvider>
      </ChatAvailabilityContext.Provider>
    </ChatHeaderDataProvider>
    </TabIdentityProvider>
    </DrawerSectionsContext.Provider>
    </CompanionShellViewer.Provider>
  );
}

function SignedOutRoutes({ onSignedIn }: { onSignedIn: () => void }) {
  return (
    <RouterRoutes>
      <Route path="sign-in" element={<BlankLayout />}>
        <Route index element={<SignInPage onSignedIn={onSignedIn} />} />
      </Route>
      {/* Any other path while signed out lands on the sign-in
          screen, not a blank no-match: nothing renders before someone is
          signed in. */}
      <Route path="*" element={<Navigate to="/sign-in" replace />} />
    </RouterRoutes>
  );
}

/** Old bookmarks to /companions/:id/edit land on the three-screen flow. */
function CompanionEditRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/companions/${encodeURIComponent(id ?? "")}/create`} replace />;
}

export function Routes({ person, onSignedIn, onPersonChange = () => {} }: { person: Roster | null; onSignedIn: () => void; onPersonChange?: () => void | Promise<void> }) {
  return <ThemeProvider>{person === null ? <SignedOutRoutes onSignedIn={onSignedIn} /> : <RoutesInner person={person} onPersonChange={onPersonChange} onSignedOut={onSignedIn} />}</ThemeProvider>;
}
