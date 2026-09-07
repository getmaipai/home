import { Select } from "@/kit/primitives/Select";
import { getIcon } from "@/kit/icons";
import { useEffect, useRef, useState, Fragment, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Page } from "@/kit/primitives/Page";
import { SettingsRenderer } from "@/kit/settings/SettingsRenderer";
import { Input } from "@/kit/ui/input";
import { Button } from "@/kit/ui/button";
import { cn, FOCUS_RING } from "@/kit/utils";
import { ChangeSecretSection } from "@/apps/settings/ChangeSecretSection";
import { HuggingFaceTokenSection } from "@/apps/settings/HuggingFaceTokenSection";
import { RoutingStatsSection } from "@/apps/settings/RoutingStatsSection";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";

interface SettingsPageProps {
  person: Roster;
  /** Re-fetches the signed-in person from App.tsx's own state. Threaded
   * down for ChangeSecretSection: a code review-adjacent gap this session
   * flagged and deferred earlier tonight (docs/dev.md's PIN-change slice)
   * - setting a first PIN left this page showing "doesn't have one yet"
   * until the next full reload, since `person` was only ever loaded once
   * at the top of the app with no way for a page to ask for a fresh copy. */
  onPersonChange: () => void;
}

interface TreeEntry {
  id: string;
  label: string;
  group: string;
  icon: string;
  description?: string;
  /** Session B step 7: a real management surface (its own route, its
   * own page - ModelsPage.tsx and friends) rather than a scroll anchor
   * on this page. Set, this entry navigates instead of scrolling and is
   * never a scrollspy target (nothing on THIS page has its id). */
  to?: string;
}

const HOUSEHOLD_TREE: TreeEntry[] = [
  { id: "settings-household.system", label: "System", group: "General", icon: "settings" },
  { id: "users-page-link", label: "Users", to: "/settings/users", group: "General", icon: "users", description: "Manage the people in your household." },
  { id: "settings-household.notifications", label: "Notifications", group: "General", icon: "bell" },
  { id: "models-page-link", label: "AI models", to: "/settings/models", group: "AI & connections", icon: "brain", description: "Choose the brain behind your conversations." },
  { id: "settings-household.integrations", label: "Integrations", group: "AI & connections", icon: "layout-grid" },
  { id: "backups-page-link", label: "Backups", to: "/settings/backups", group: "Maintenance", icon: "archive", description: "Keep your household’s data backed up." },
  { id: "repairs-page-link", label: "Repairs", to: "/settings/repairs", group: "Maintenance", icon: "shield-check", description: "Check issues that need your attention." },
  { id: "health-page-link", label: "Health", to: "/settings/health", group: "Maintenance", icon: "activity", description: "See how MaiPai Home is running, and restart it." },
  { id: "settings-household.ai", label: "AI model tuning", group: "Advanced", icon: "brain" },
  { id: "section-hf-token", label: "Hugging Face token", group: "Advanced", icon: "lock" },
  { id: "section-routing", label: "Plugin routing", group: "Advanced", icon: "layout-grid" },
];

const PERSON_TREE: TreeEntry[] = [
  { id: "settings-profile.appearance", label: "Appearance", group: "Your experience", icon: "sparkles" },
  { id: "settings-person.persona", label: "Personality", group: "Your experience", icon: "user" },
  { id: "settings-person.voice", label: "Voice", group: "Your experience", icon: "volume-2" },
  { id: "settings-person.notifications", label: "My notifications", group: "Your experience", icon: "bell" },
  { id: "voices-page-link", label: "Voices", to: "/settings/voices", group: "Make it yours", icon: "volume-2", description: "Find a voice you enjoy listening to." },
  { id: "commands-page-link", label: "Commands", to: "/settings/commands", group: "Make it yours", icon: "sparkles", description: "Create shortcuts for everyday requests." },
  { id: "devices-page-link", label: "Devices & sessions", to: "/settings/devices", group: "Account", icon: "shield-check", description: "See where you’re signed in." },
  { id: "section-change-secret", label: "PIN / password", group: "Account", icon: "lock" },
];

// A code review (2026-09-06) found `tab` deriving from `?tab=` alone once
// Models/Backups/Voices/Commands became nested routes: clicking a
// PERSON_TREE link (`navigate(entry.to)`) drops whatever `tab` query was
// in the URL, so `tab` fell back to "household" even while Voices/Commands
// content was on screen - the sidebar swapped to HOUSEHOLD_TREE, which
// doesn't even contain the page you're looking at. A direct/bookmarked URL
// like `/settings/backups?tab=me` hit the same desync the other way.
// Whichever tree actually contains the current path is the one honest
// source of truth for it - the query param only matters on the plain
// `/settings` index route, where the path itself says nothing.
const HOUSEHOLD_ROUTE_PATHS = new Set(HOUSEHOLD_TREE.flatMap((e) => (e.to ? [e.to] : [])));
const PERSON_ROUTE_PATHS = new Set(PERSON_TREE.flatMap((e) => (e.to ? [e.to] : [])));

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The one real piece of shape the Household and Me tab bodies shared - a
// hand-built section, hidden while a search is active, in its own
// vertical stack - pulled out on its own after a code review (2026-09-05)
// caught the two ~60-line bodies drifting (PERSON_TREE's own copy of the
// "My notifications" label going stale). The sections themselves stay
// inline in each branch: they differ too much (different components,
// different props, an owner/admin gate only the household branch needs)
// to earn a shared list-of-components abstraction on top of this.
function ExtraSections({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  if (hidden) return null;
  return <div className="flex flex-col gap-6">{children}</div>;
}

// Step 7's own shape (docs/plans/session-b-ui.md: "a tree sidebar..., a
// search filter..., scope tabs... URL-bound"), built now rather than at
// its own turn: a design review (2026-09-05), reference in hand (VS
// Code's own Settings editor - a User/Workspace tab pair, a tree on the
// left, a search box, each setting stacked title/description/control),
// found the flat single-column list from step 2 read as "nothing like"
// that reference. Tabs map onto the two scopes this page already
// rendered stacked: "Household" (VS Code's Workspace) and "Me" (User).
// Device-scope has no real keys yet (docs/SETTINGS.md's third scope,
// still theoretical) - no tab for it until one does; inventing an empty
// tab ahead of need is exactly what docs/UI.md warns against.
export function SettingsPage({ person, onPersonChange }: SettingsPageProps) {
  // Shares the real definition (backend/src/wire.ts's isOwnerOrAdminRole,
  // the same one backend/src/lib/access.ts's isOwnerOrAdmin and
  // apps/people/roles.ts's requiresSecret use) instead of a third
  // hand-copy of "owner or admin" (a code review, 2026-09-04, found
  // exactly that here).
  const canManageBackups = isOwnerOrAdminRole(person.role);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  // Household-scope settings are readable by anyone signed in but
  // writable only by owner/admin (backend/src/lib/settings.ts's
  // assertCanAccessScope) - Jesse, 2026-09-05, asked directly whether
  // "Household" was meant to be the admin-only tab. It should be: a
  // non-admin landing there would see live-looking controls that
  // silently 403 on every change. Forced to "me" for anyone else, with
  // no tab switcher shown at all - there is only one scope they can act
  // on, so there is nothing to switch between.
  const routeTab: "household" | "me" | null = HOUSEHOLD_ROUTE_PATHS.has(location.pathname)
    ? "household"
    : PERSON_ROUTE_PATHS.has(location.pathname)
      ? "me"
      : null;
  // A code review (2026-09-06) found the admin-forced-"me" check running
  // BEFORE routeTab: a non-admin who lands on a household-only nested
  // route by URL (bookmarked, typed, or shared) got the Me tree in the
  // rail even though the page actually on screen (Backups/AI models,
  // denied or not) belongs to Household - nothing in the sidebar matched
  // what they were looking at. The route itself is what's actually on
  // screen; it wins over both the query param and the admin-forced
  // default.
  const tab: "household" | "me" = routeTab ?? (!canManageBackups ? "me" : searchParams.get("tab") === "me" ? "me" : "household");
  // Models/Backups/Voices/Commands are nested child routes (App.tsx) now,
  // rendered through <Outlet/> below - anything that isn't one of their
  // known paths shows this page's own default (tab-switched) content
  // instead. A code review (2026-09-06) found the original literal
  // `location.pathname === "/settings"` check both duplicated App.tsx's
  // own route path with no compiler link between the two, AND rendered a
  // blank Outlet for the harmless `/settings/` (trailing slash) case,
  // since nothing there matches a nested route either. Deriving this from
  // `routeTab` (already the single source of truth for "does this path
  // name a known nested route") fixes both at once: `null` means neither
  // tree recognizes this path, so it's the default view.
  const isDefaultRoute = routeTab === null;

  function setTab(next: "household" | "me") {
    // Switching scope while looking at a nested page (e.g. Backups, which
    // is household-only) would otherwise leave the tree showing the OTHER
    // scope's entries highlighted against content that doesn't belong to
    // either - a state that couldn't happen before these became nested
    // routes, since the tab switcher didn't exist alongside them yet.
    // Land back on this page's own default content instead.
    if (!isDefaultRoute) {
      navigate(`/settings?tab=${next}`);
      return;
    }
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("tab", next);
      return params;
    });
  }

  const tree = tab === "household" ? HOUSEHOLD_TREE : PERSON_TREE;
  function openEntry(entry: TreeEntry) {
    if (entry.to) { navigate(entry.to); return; }
    setSearch("");
    navigate(`/settings?tab=${tab}#${entry.id}`);
    if (isDefaultRoute) scrollToSection(entry.id);
  }
  const shortcuts = tree.filter((entry) => entry.to && (!search.trim() || `${entry.label} ${entry.description}`.toLowerCase().includes(search.trim().toLowerCase())));

  // The tree highlights whichever section is scrolled near the top of
  // the content pane, the same "scrollspy" VS Code's own Settings editor
  // does (Jesse, 2026-09-05: "show active highlighted item") - a
  // shrunk-root IntersectionObserver (only the top 30% of the scroll
  // container counts) rather than "whatever crosses 0%", so a section
  // only takes the highlight once it's actually near the reading
  // position, not the instant its bottom edge peeks into view.
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b));
        setActiveId(topmost.target.id);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    // Re-scans on every DOM change under `root`, not just when `tree`/
    // `search` change: a code review (2026-09-05) found the original
    // version ran once at mount, before SettingsRenderer's own network-
    // backed queries had resolved - none of the section elements existed
    // yet, so it observed nothing and never got a second chance (neither
    // dependency changes once the data actually arrives). A
    // MutationObserver re-syncs on that first data-arrival, on a tab
    // switch, on a search keystroke, and on the advanced-settings fold
    // toggle alike, so nothing else has to know or track exactly when
    // section elements come and go.
    let jumped = false;
    function resync() {
      const target = tree.find((entry) => `#${entry.id}` === location.hash);
      if (!jumped && target && document.getElementById(target.id)) {
        scrollToSection(target.id);
        jumped = true;
      }
      observer.disconnect();
      for (const entry of tree) {
        const el = document.getElementById(entry.id);
        if (el) observer.observe(el);
      }
    }
    resync();
    const mutationObserver = new MutationObserver(resync);
    mutationObserver.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [tree, location.hash, location.pathname]);

  return (
    <Page title="Settings" hideTitle>
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-5 overflow-hidden px-4 py-5 sm:px-6">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">Settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tab === "household" ? "Manage your shared home, AI, and connected services." : "Your voice, your preferences, your MaiPai."}</p>
        </div>
        {/* Household/Me is the primary scope switcher, not a nice-to-have
            nav aid - it stays visible and reachable at every width, even
            once the tree sidebar below hides for lack of room. A design
            review (2026-09-05) caught an earlier draft hiding both
            together under the same breakpoint, which made "Me" scope
            settings (Voice, Personality, Change PIN, Commands)
            unreachable on anything narrower than 1024px. Shown only to
            owner/admin: a non-admin has nothing to switch to (see `tab`
            above) - there is no tab bar to render for one destination. */}
        {canManageBackups ? (
          <div className="flex w-full max-w-xs gap-1 rounded-xl bg-muted/60 p-1 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={tab === "household"}
              onClick={() => setTab("household")}
              className={cn("h-auto flex-1 rounded-md px-2 py-1.5", tab === "household" ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
            >
              Household
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={tab === "me"}
              onClick={() => setTab("me")}
              className={cn("h-auto flex-1 rounded-md px-2 py-1.5", tab === "me" ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
            >
              Me
            </Button>
          </div>
        ) : null}

        <div className="lg:hidden">
          <Select aria-label="Settings section" value={tree.find((entry) => entry.to === location.pathname)?.id ?? activeId ?? tree[0]!.id} options={tree.map((entry) => entry.id)} getLabel={(id) => tree.find((entry) => entry.id === id)?.label ?? id} onValueChange={(id) => { const entry = tree.find((item) => item.id === id); if (entry) openEntry(entry); }} />
        </div>
        <div className="flex min-h-0 flex-1 gap-6 overflow-hidden">
          {/* The tree sidebar: a second, page-local sidebar alongside the
              shell's own global one (VS Code's own settings editor is the
              same idea - its own tree lives inside the editor tab, not in
              place of the activity bar). Scrolls the content pane to a
              section rather than owning a second copy of it. `lg`, not
              `md`: the tree plus the shell's own global sidebar leaves the
              content column badly squeezed below ~1024px (found live at
              an 800px viewport - a settings row wrapped into a near-
              vertical stack of single words). Below that width, the tree
              hides and the content gets the full column back. */}
          <aside aria-label="Settings navigation" className="hidden w-52 shrink-0 flex-col gap-1 overflow-y-auto pe-2 lg:flex">
            {tree.map((entry, index) => {
              const Icon = getIcon(entry.icon);
              // A routed entry (`to`) is active by URL match, not scroll
              // position - it has no in-page anchor for the scrollspy
              // IntersectionObserver above to ever find. `activeId` only
              // means anything on the default route: a code review
              // (2026-09-06) found it never gets cleared on navigating
              // into a nested route (there's nothing there for the
              // observer to re-target), so its last value from before the
              // navigation stayed highlighted alongside the newly-active
              // routed entry - two entries lit up at once.
              const isActive = entry.to ? location.pathname === entry.to : isDefaultRoute && activeId === entry.id;
              return (
                <Fragment key={entry.id}>
                {index === 0 || tree[index - 1]?.group !== entry.group ? <p className="px-3 pt-4 pb-1 text-xs font-medium text-muted-foreground">{entry.group}</p> : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openEntry(entry)}
                  // A screen-reader read-through (2026-09-06) found the
                  // active tree entry only ever signaled by color/weight
                  // (`bg-muted font-medium`) - real for a sighted user,
                  // silent for anyone using a screen reader, who heard
                  // a flat list of buttons with no sense of "you are
                  // here." "page" only for a routed entry (`entry.to`) -
                  // a real navigation; a scroll-anchor entry never
                  // navigates anywhere, so it gets List.tsx's own
                  // established convention for "selected, not navigated"
                  // (`aria-current="true"`) instead, a code review
                  // (2026-09-06) caught a flat "page" applying the exact
                  // same signal to both kinds of entry.
                  aria-current={isActive ? (entry.to ? "page" : "true") : undefined}
                  className={cn(
                    "h-auto min-h-10 justify-start gap-2.5 rounded-xl px-3 py-2 text-left font-normal",
                    isActive ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-4" />{entry.label}
                </Button>
                </Fragment>
              );
            })}
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            {isDefaultRoute ? <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search settings" aria-label="Search settings" className="h-11 rounded-xl bg-card" /> : <Link to={`/settings?tab=${tab}`} className={cn("w-fit rounded-lg py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:text-foreground", FOCUS_RING)}>← All {tab === "me" ? "personal" : "household"} settings</Link>}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
            <div ref={scrollRef} tabIndex={0} className={cn("flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto", FOCUS_RING)}>
              {isDefaultRoute && shortcuts.length > 0 ? <div className="grid gap-3 sm:grid-cols-2">
                {shortcuts.map((entry) => { const Icon = getIcon(entry.icon); return <Link key={entry.id} to={entry.to!} className={cn("flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40 focus-visible:border-primary/40", FOCUS_RING)}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon aria-hidden className="size-4" /></span>
                  <span><span className="block text-sm font-semibold">{entry.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{entry.description}</span></span>
                </Link>; })}
              </div> : null}
              {!isDefaultRoute ? (
                // Models/Backups/Voices/Commands (App.tsx's nested routes) -
                // rendered right here so the rail/tab switcher/search above
                // stay mounted instead of the whole page unmounting.
                <Outlet />
              ) : tab === "household" ? (
                <>
                  <SettingsRenderer scope="household" scopeValue="household" filter={search} />
                  <ExtraSections hidden={!!search.trim()}>
                    {/* voice.hf_token is a household-scope key: writing it
                        already requires owner/admin (lib/settings.ts's
                        assertCanAccessScope), same gate ModelsPage.tsx/
                        BackupsPage.tsx apply on their own dedicated
                        routes now (Session B step 7). */}
                    {canManageBackups ? (
                      <div id="section-hf-token">
                        <HuggingFaceTokenSection />
                      </div>
                    ) : null}
                    {canManageBackups ? (
                      <div id="section-routing">
                        <RoutingStatsSection />
                      </div>
                    ) : null}
                  </ExtraSections>
                </>
              ) : (
                <>
                  <SettingsRenderer scope="person" scopeValue={`person:${person.id}`} filter={search} />
                  <ExtraSections hidden={!!search.trim()}>
                    <div id="section-change-secret">
                      <ChangeSecretSection person={person} onChanged={onPersonChange} />
                    </div>
                  </ExtraSections>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
