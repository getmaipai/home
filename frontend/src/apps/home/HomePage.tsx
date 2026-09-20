import { favoriteApps } from "@/shell/appCatalog";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { cn, FOCUS_RING } from "@maipai/ui/src/utils";
import { CardGrid } from "@maipai/ui/src/primitives/CardGrid";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { MetricCard } from "@maipai/ui/src/blocks/cards/MetricCard";
import { PanelHeader } from "@maipai/ui/src/blocks/cards/PanelHeader";
import { ActionTile } from "@maipai/ui/src/blocks/cards/ActionTile";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import type { IconName } from "@maipai/ui/src/icons";
import { CardSizeSlider, useCardSize, cardSizeStyle } from "@maipai/ui/src/primitives/CardSizeSlider";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { api, ApiError, type Roster, type PersonRosterEntry, type ResolvedSetting, type MemoryRecord, type ConversationSummary, type WidgetDescriptor } from "@/lib/api";
import { runFixedTurn } from "@/apps/home/runFixedTurn";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useHubStatus, updateAvailable } from "@/shell/useHubStatus";
import { weatherCardQuestion } from "@maipai/home-backend/src/homeCardQuestions";

interface HomePageProps {
  person: Roster;
}

// Shares the Settings page's own cache entry for this scope
// (SettingsRenderer.tsx: `["settings-values", scopeValue]`) rather than a
// second fetch of the same household settings, and shared here by
// WeatherCard alone rather than declaring an identical `useQuery` of its
// own. A household changes its own settings rarely, hence the 5-minute
// staleTime.
function useHouseholdSettings() {
  return useQuery({
    queryKey: ["settings-values", "household"],
    queryFn: () => api.settingsValues("household"),
    staleTime: 5 * 60 * 1000,
  });
}

function textSetting(values: ResolvedSetting[] | undefined, key: string): string | undefined {
  const value = values?.find((s) => s.key === key)?.value;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function panelCard(children: ReactNode, className?: string) {
  return <div className={cn("rounded-2xl border bg-[var(--surface-card)] p-4", className)}>{children}</div>;
}

// The Chat/Voice metric cards' big text (spec "The dashboard": "Chat
// (ready or the reason)"/"Voice (listening and speaking ready)") -
// health.brain/health.voice carry the real EngineHealthKind strings
// (backend/src/wire.ts: url/override/selection/stub/stopped/starting/
// none/spawned/restarting/failed - the same set useEngineHealth()'s own
// poll reads for ChatPage's composer gate, reused here from
// useHubStatus()'s single shared /api/health read rather than a second
// poller). Every "operational" kind (url/override/selection/stub/
// spawned, or anything not in the table below) reads as ready; the
// table is deliberately the exceptions, not an allow-list, so a kind
// this file hasn't heard of yet still reads as ready rather than
// silently falling through to it.
const ENGINE_STATE_TEXT: Record<string, string> = {
  starting: "Starting",
  restarting: "Starting",
  stopped: "Stopped",
  failed: "Failed",
  none: "Not set up",
};

function engineStateText(kind: string | undefined): string {
  if (!kind) return "Checking...";
  return ENGINE_STATE_TEXT[kind] ?? "Ready";
}

function engineReady(kind: string | undefined): boolean {
  return !!kind && !(kind in ENGINE_STATE_TEXT);
}

function MetricRow({ person }: { person: Roster }) {
  const { health, repairs, updates, canManage } = useHubStatus(person.role);
  const hasUpdate = updateAvailable(updates);
  const repairsCount = canManage ? (repairs ? String(repairs.length) : "...") : "—";
  const repairsState = canManage ? (repairs ? (repairs.length === 0 ? "All good" : "View repairs") : undefined) : "Admins only";
  const repairsHref = canManage && repairs && repairs.length > 0 ? "/settings/repairs" : undefined;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard icon="message-circle" hue="--hue-blue" count={engineStateText(health?.brain)} label="Chat" state={health?.brain === "stopped" || health?.brain === "failed" ? "Not answering - an admin can restart it" : undefined} stateHref={health?.brain === "stopped" || health?.brain === "failed" ? "/settings/health" : undefined} />
      <MetricCard icon="mic" hue="--hue-violet" count={engineStateText(health?.voice)} label="Voice" state={engineReady(health?.voice) ? "Listening and speaking ready" : undefined} />
      <MetricCard icon="download" hue="--hue-teal" count={updates ? (hasUpdate ? "1" : "0") : "..."} label="Updates" state={updates ? (hasUpdate ? `${updates.latest} available` : "Up to date") : undefined} stateHref={hasUpdate ? "/settings" : undefined} />
      <MetricCard icon="wrench" hue="--hue-orange" count={repairsCount} label="Repairs" state={repairsState} stateHref={repairsHref} />
    </div>
  );
}

function WeatherLine() {
  const settingsQuery = useHouseholdSettings();
  const place = textSetting(settingsQuery.data, "household.home_place");
  const question = weatherCardQuestion(place);
  // Cached by the query layer - a real turn through the shared engine,
  // not a separate widget backend, per the plugin model every package
  // uses. 30 minutes: often enough that "today" never looks stale, rare
  // enough that opening Home repeatedly in a session doesn't create a
  // new turn (and a new conversation-history row) every time.
  const query = useQuery({
    queryKey: ["home-turn", "weather", question],
    queryFn: () => runFixedTurn(question),
    staleTime: 30 * 60 * 1000,
    retry: false,
    enabled: !settingsQuery.isPending,
  });
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <IconTile icon="sparkles" hue="--hue-blue" size="sm" glow={false} />
        <span>{settingsQuery.isPending || query.isLoading ? "Checking the weather..." : (query.data ?? "Couldn't check the weather right now.")}</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <IconTile icon="calendar" hue="--hue-violet" size="sm" glow={false} />
        <span>{today}</span>
      </div>
    </div>
  );
}

function RecentMemoriesPanel() {
  const navigate = useNavigate();
  // The same `["memory-list", "me"]` key MemoryPage.tsx's own
  // `OwnMemories` uses for the actor's own list - one cache entry, not a
  // second fetch, and forgetting or archiving a memory anywhere
  // invalidates this panel too.
  const query = useQuery<MemoryRecord[]>({ queryKey: ["memory-list", "me"], queryFn: () => api.memories() });
  const recent = [...(query.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  return panelCard(
    <>
      <PanelHeader icon="brain" hue="--hue-teal" title="Recent memories" linkLabel="View all" linkAriaLabel="View all memories" onLinkClick={() => navigate("/memory")} />
      <div className="mt-3">
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing remembered yet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {recent.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--hue-teal)]" />
                <span className="truncate">{m.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>,
  );
}

function TodayPanel() {
  return panelCard(
    <>
      <PanelHeader icon="calendar" hue="--hue-blue" title="Today" />
      <div className="mt-3">
        <WeatherLine />
      </div>
    </>,
  );
}

// One strip, one tile shape, two real sources (COORDINATOR, 2026-09-20:
// "pinned apps and installed packages together as tiles... one empty
// state... no second heading" - the section's own "Your apps" line
// never asked for a second "Your packages" section, and the live-data
// widget cards that used to render there belong on their own package
// pages, not duplicated here). An app tile is a pin state, not a
// separate list; a package tile is just its installed identity
// (WidgetDescriptor has no live value worth a compact tile - that
// detail lives in the widget's own bigger card, wherever it ends up).
interface AppStripTile {
  kind: "app";
  key: string;
  to: string;
  icon: IconName;
  label: string;
}
interface PackageStripTile {
  kind: "package";
  key: string;
  title: string;
}
type StripTile = AppStripTile | PackageStripTile;

function YourAppsPanel({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const { pinned } = usePinnedApps(person.id);
  // The density control (spec "The dashboard": "the card-size slider
  // stays as the strip's density control") - this strip's own setting,
  // not shared with anything else now that "Your packages" is merged
  // into it rather than a second consumer (COORDINATOR, 2026-09-20).
  const [cardSize, setCardSize] = useCardSize("home");
  const appTiles: StripTile[] = favoriteApps(pinned).map((e) => ({ kind: "app", key: `app-${e.to}`, to: e.to, icon: e.icon as IconName, label: e.label }));
  const widgetsQuery = useQuery<WidgetDescriptor[]>({ queryKey: ["widgets"], queryFn: () => api.widgets() });
  const packageTiles: StripTile[] = (widgetsQuery.data ?? []).map((w) => ({ kind: "package", key: `pkg-${w.package}-${w.id}`, title: w.title }));
  const tiles = [...appTiles, ...packageTiles];
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <PanelHeader icon="layout-grid" hue="--hue-blue" title="Your apps" linkLabel="Browse all" onLinkClick={() => navigate("/apps")} className="min-w-0 flex-1 border-b-0 pb-0" />
        {/* Hidden on the phone: a density control has little room to
            matter once the grid is already down to one or two columns,
            and it was squeezing the title into a truncated sliver in
            the row's shared space. */}
        <div className="hidden shrink-0 sm:block">
          <CardSizeSlider size={cardSize} onChange={setCardSize} />
        </div>
      </div>
      <div className="mt-3" style={cardSizeStyle(cardSize)}>
        <CardGrid
          label="Your apps"
          items={tiles}
          getKey={(t) => t.key}
          getLabel={(t) => (t.kind === "app" ? t.label : t.title)}
          onSelect={(t) => navigate(t.kind === "app" ? t.to : "/apps")}
          emptyState={{ icon: "pin", text: "Pin your go-to apps from the app library." }}
          renderItem={(t) => (
            <div className="flex flex-col items-center gap-2 p-4">
              <IconTile icon={t.kind === "app" ? t.icon : "package"} hue={t.kind === "app" ? "--hue-blue" : "--hue-teal"} />
              <span className="text-sm">{t.kind === "app" ? t.label : t.title}</span>
            </div>
          )}
        />
      </div>
    </div>
  );
}

// "Who is here" (step 6): the household roster, not live presence - no
// session/presence infrastructure exists yet (docs/BACKLOG.md's own note,
// "presence unknown for now"). Showing who lives here is still real and
// useful on its own; it just isn't "who is home right now" yet.
function PeoplePanel({ selfId }: { selfId: string }) {
  const navigate = useNavigate();
  const query = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: api.people });
  const people = query.data ?? [];
  return panelCard(
    <>
      <PanelHeader icon="users" hue="--hue-violet" title="People" linkLabel="View all" linkAriaLabel="View all people" onLinkClick={() => navigate("/people")} />
      {people.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No one else in this household yet.</p>
      ) : (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent).
        <div tabIndex={0} className={cn("mt-3 flex min-h-[72px] shrink-0 items-center gap-3 overflow-x-auto", FOCUS_RING)}>
          {people.map((p) => (
            <div key={p.id} className="flex shrink-0 flex-col items-center gap-1">
              <Avatar name={p.display_name} className="h-10 w-10 text-sm" />
              {/* text-base, not text-xs: the type floor (docs/UI.md). */}
              <span className="text-base text-muted-foreground">{p.id === selfId ? "You" : p.display_name}</span>
            </div>
          ))}
        </div>
      )}
    </>,
  );
}

interface ActivityRow {
  id: string;
  text: string;
  at: string;
  hue: string;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The household row's Activity panel (spec "The dashboard": "the last
// five events: a chat, a package added, an update applied, with colored
// dots and times"). Home has no dedicated activity/audit log yet
// (docs/BACKLOG.md), so this merges two real feeds client-side rather
// than fabricating one - recent conversations and recent memories, both
// already fetched for their own panels above, by real timestamp.
function ActivityPanel() {
  const conversationsQuery = useQuery<ConversationSummary[]>({ queryKey: ["conversations-list", null, ""], queryFn: () => api.conversationList() });
  const memoriesQuery = useQuery<MemoryRecord[]>({ queryKey: ["memory-list", "me"], queryFn: () => api.memories() });
  const fromConversations: ActivityRow[] = (conversationsQuery.data ?? [])
    .filter((c) => c.last_turn_at)
    .map((c) => ({ id: `conv-${c.id}`, text: c.title ? `Chat: ${c.title}` : "A new conversation", at: c.last_turn_at!, hue: "--hue-blue" }));
  const fromMemories: ActivityRow[] = (memoriesQuery.data ?? []).map((m) => ({ id: `mem-${m.id}`, text: `Remembered: ${m.text}`, at: m.created_at, hue: "--hue-teal" }));
  const rows = [...fromConversations, ...fromMemories].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  return panelCard(
    <>
      <PanelHeader icon="activity" hue="--hue-teal" title="Activity" />
      <div className="mt-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has happened yet today.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-sm">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: `var(${row.hue})` }} />
                <span className="min-w-0 flex-1 truncate">{row.text}</span>
                {/* text-base, not text-xs: the type floor (docs/UI.md). */}
                <span className="shrink-0 text-base text-muted-foreground">{relativeTime(row.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>,
  );
}

// Quick actions (spec "The dashboard"): Ask MaiPai, Add a person, Check
// for updates, Open Repairs - real destinations (Settings > Users has
// "Add someone", Settings > Repairs is RepairsPage), not invented ones.
// "Check for updates" calls the real POST /api/updates/check rather
// than navigating anywhere, mirroring the reference's own action tiles.
// The route's own gate is owner/admin OR a backups.run grant; `Roster`
// carries no client-visible grant list to check the latter against, so
// `canCheckUpdates` is a role-only approximation - a person holding only
// a backups.run grant won't see this tile even though the backend would
// accept their request. Known, accepted gap, not silently wrong: the
// tile's absence never claims they lack access, it just doesn't offer
// the shortcut.
function QuickActionsPanel({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const canCheckUpdates = person.role === "owner" || person.role === "admin";
  async function checkForUpdates() {
    try {
      const result = await api.checkForUpdate();
      push(updateAvailable(result) ? `${result.latest} is available.` : "MaiPai Home is up to date.");
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Could not check for updates.");
    }
  }
  return panelCard(
    <>
      <PanelHeader icon="sparkles" hue="--hue-orange" title="Quick actions" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ActionTile icon="message-circle" hue="--hue-blue" label="Ask MaiPai" subtitle="Start a conversation" onClick={() => navigate("/chat")} />
        <ActionTile icon="users" hue="--hue-violet" label="Add a person" subtitle="Grow the household" onClick={() => navigate("/settings/users")} />
        {canCheckUpdates ? <ActionTile icon="refresh-cw" hue="--hue-teal" label="Check for updates" subtitle="Look for a new release" onClick={() => void checkForUpdates()} /> : null}
        <ActionTile icon="wrench" hue="--hue-orange" label="Open Repairs" subtitle="See what needs attention" onClick={() => navigate("/settings/repairs")} />
      </div>
    </>,
  );
}

export function HomePage({ person }: HomePageProps) {
  // hideTitle: the fixed header (spec "Current destination header
  // rule") now owns the destination's title and subtitle, including the
  // signed-in person's own greeting (shell/routeHeader.ts) - a second
  // one here would be exactly the duplicate header that rule forbids.
  return (
    <Page title="Home" hideTitle>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-8", FOCUS_RING)}>
        <MetricRow person={person} />

        <div className="grid gap-3 lg:grid-cols-2">
          <TodayPanel />
          <RecentMemoriesPanel />
        </div>

        <YourAppsPanel person={person} />

        <div className="grid gap-3 lg:grid-cols-3">
          <PeoplePanel selfId={person.id} />
          <ActivityPanel />
          <QuickActionsPanel person={person} />
        </div>
      </div>
    </Page>
  );
}
