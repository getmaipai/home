import { favoriteApps } from "@/shell/appCatalog";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { cn, FOCUS_RING } from "@maipai/ui/src/utils";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { MetricCard } from "@maipai/ui/src/blocks/cards/MetricCard";
import { PanelHeader } from "@maipai/ui/src/blocks/cards/PanelHeader";
import { ActionTile } from "@maipai/ui/src/blocks/cards/ActionTile";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import { getIcon, type IconName } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/ui/button";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { usePhoneMode } from "@maipai/ui/src/blocks/phone/PhoneMode";
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

function RecentMemoriesPanel({ selfId }: { selfId: string }) {
  const navigate = useNavigate();
  // The same `["memory-list", "me"]` key `PersonMemories.tsx`'s own
  // `OwnMemories` uses for the actor's own list - one cache entry, not a
  // second fetch, and forgetting or archiving a memory anywhere
  // invalidates this panel too.
  const query = useQuery<MemoryRecord[]>({ queryKey: ["memory-list", "me"], queryFn: () => api.memories() });
  const recent = [...(query.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  return panelCard(
    <>
      {/* Opens the signed-in person's own Memories tab (owner ruling,
          "Navigation, corrected," 2026-09-20) - Memories no longer has
          a rail destination of its own. */}
      <PanelHeader icon="brain" hue="--hue-teal" title="Recent memories" linkLabel="View all" linkAriaLabel="View all memories" onLinkClick={() => navigate(`/people/${selfId}?tab=memories`)} />
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

// A compact installed-components row (owner correction, HOME-UI-02c's
// own capture review, 2026-09-20: "'Your apps' on the dashboard is the
// reference's installed-components strip (a row of compact tiles: icon
// tile left, name, one-line count or state), not tall cards with a
// centered icon and a density slider") - the reference's own "Models
// 12 installed" pattern, one tile per pinned app/package instead of a
// category. No live per-item count or state exists for a package tile
// yet (`WidgetDescriptor` carries none - this file's own older comment
// already said so), so the one-line label is honest about what each
// tile is (App/Package) rather than a fabricated number.
function AppsRow({ tiles, onSelect }: { tiles: StripTile[]; onSelect: (t: StripTile) => void }) {
  if (tiles.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">Pin your go-to apps from the app library.</p>;
  }
  return (
    <div role="list" aria-label="Your apps" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        // role="list" needs a role="listitem" child, but a Button is
        // interactive and jsx-a11y/no-interactive-element-to-
        // noninteractive-role refuses that role directly on it (a
        // review on this exact component, 2026-09-20) - a plain,
        // non-interactive wrapper carries the item role instead, found
        // missing entirely by axe's own aria-required-children check
        // once role="list" had zero role="listitem" children.
        <div key={t.key} role="listitem">
          <Button
            type="button"
            variant="outline"
            onClick={() => onSelect(t)}
            className="h-auto w-full min-w-0 items-center justify-start gap-3 rounded-xl border bg-[var(--surface-card)] p-3 text-left font-normal hover:bg-[var(--surface-pane)]"
          >
            <IconTile icon={t.kind === "app" ? t.icon : "package"} hue={t.kind === "app" ? "--hue-blue" : "--hue-teal"} size="sm" glow={false} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{t.kind === "app" ? t.label : t.title}</span>
              {/* Deliberate type-floor exception (docs/UI.md, lane 7 item
                  3): a compact secondary label under a tile's own title,
                  the same category as a nav group heading or a badge. */}
              <span className="text-xs text-muted-foreground">{t.kind === "app" ? "App" : "Package"}</span>
            </div>
          </Button>
        </div>
      ))}
    </div>
  );
}

function YourAppsPanel({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const { pinned } = usePinnedApps(person.id);
  const appTiles: StripTile[] = favoriteApps(pinned).map((e) => ({ kind: "app", key: `app-${e.to}`, to: e.to, icon: e.icon as IconName, label: e.label }));
  const widgetsQuery = useQuery<WidgetDescriptor[]>({ queryKey: ["widgets"], queryFn: () => api.widgets() });
  const packageTiles: StripTile[] = (widgetsQuery.data ?? []).map((w) => ({ kind: "package", key: `pkg-${w.package}-${w.id}`, title: w.title }));
  const tiles = [...appTiles, ...packageTiles];
  return (
    <div>
      <PanelHeader icon="layout-grid" hue="--hue-blue" title="Your apps" linkLabel="Browse all" onLinkClick={() => navigate("/apps")} />
      <AppsRow tiles={tiles} onSelect={(t) => navigate(t.kind === "app" ? t.to : "/apps")} />
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

// The phone dashboard (owner reference, "The phone composition,"
// 2026-09-20, folded into the same "Phone density" findings this
// item's own acceptance judges): a distinct, denser composition from
// the desktop's - the same tokens, icons and data, never the desktop's
// own panels shrunk down. A hero card up top (the ask invitation, or
// the day's one real thing to know about - a repair or an update),
// a compact four-tile metric strip, two horizontal shelves (recent
// conversations, recent memories), then a two-column app card grid.
// Section headers here are a plain title/subtitle pair, no icon tile
// (the reference's own phone section headers drop it - "no tile on
// the phone" is the ruling's own words) - `PanelHeader` is the
// desktop's own pattern, not reused here on purpose.
function PhoneSectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mt-6 mb-3 flex flex-col gap-0.5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function PhoneHeroCard({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const { repairs, updates, canManage } = useHubStatus(person.role);
  const hasUpdate = updateAvailable(updates);
  // The day's one real thing (a repair, then an update), or the plain
  // ask invitation when there is nothing to say - never both at once,
  // the reference's own "one full-width card... the day's headline."
  if (canManage && repairs && repairs.length > 0) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => navigate("/settings/repairs")}
        className="h-auto w-full flex-col items-start gap-1 rounded-2xl p-5 text-left font-normal"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--hue-orange) 22%, var(--surface-card)), var(--surface-card))" }}
      >
        <span className="text-sm font-medium text-muted-foreground">Today</span>
        <span className="text-lg font-semibold">
          {repairs.length} repair{repairs.length === 1 ? "" : "s"} need{repairs.length === 1 ? "s" : ""} attention
        </span>
        <span className="mt-2 text-sm text-primary">Open Repairs →</span>
      </Button>
    );
  }
  if (hasUpdate) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => navigate("/settings")}
        className="h-auto w-full flex-col items-start gap-1 rounded-2xl p-5 text-left font-normal"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--hue-teal) 22%, var(--surface-card)), var(--surface-card))" }}
      >
        <span className="text-sm font-medium text-muted-foreground">Today</span>
        <span className="text-lg font-semibold">{updates?.latest} is available</span>
        <span className="mt-2 text-sm text-primary">View updates →</span>
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => navigate("/chat")}
      className="h-auto w-full flex-col items-start gap-1 rounded-2xl p-5 text-left font-normal"
      style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--hue-violet) 20%, var(--surface-card)), color-mix(in srgb, var(--hue-blue) 20%, var(--surface-card)))" }}
    >
      <span className="text-lg font-semibold">Ask MaiPai</span>
      <span className="text-sm text-muted-foreground">Anything on your mind - just ask.</span>
      <span className="mt-2 inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Start a conversation</span>
    </Button>
  );
}

function PhoneMetricStrip({ person }: { person: Roster }) {
  const { health, repairs, updates, canManage } = useHubStatus(person.role);
  const hasUpdate = updateAvailable(updates);
  const tiles: { icon: IconName; hue: string; state: string }[] = [
    { icon: "message-circle", hue: "--hue-blue", state: engineStateText(health?.brain) },
    { icon: "mic", hue: "--hue-violet", state: engineStateText(health?.voice) },
    { icon: "download", hue: "--hue-teal", state: updates ? (hasUpdate ? "Update" : "Up to date") : "…" },
    { icon: "wrench", hue: "--hue-orange", state: canManage ? (repairs ? (repairs.length === 0 ? "Good" : `${repairs.length} open`) : "…") : "—" },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.map((t, i) => (
        <div key={i} className="flex flex-col items-center gap-1 rounded-xl border bg-[var(--surface-card)] p-2 text-center">
          <IconTile icon={t.icon} hue={t.hue} size="sm" glow={false} />
          {/* Deliberate type-floor exception (docs/UI.md, lane 7 item
              3): the phone metric strip's own one-word state, the
              ruling's own "12px supporting" phone type scale. */}
          <span className="text-xs text-muted-foreground">{t.state}</span>
        </div>
      ))}
    </div>
  );
}

interface ShelfItem {
  key: string;
  label: string;
  sublabel: string;
  onClick: () => void;
}

// Horizontal shelves (recent conversations, recent memories): 160px
// cards, a "+" first card where adding makes sense (a new chat).
function PhoneShelf({ items, onAdd, addLabel, emptyText }: { items: ShelfItem[]; onAdd?: () => void; addLabel?: string; emptyText: string }) {
  const PlusIcon = getIcon("plus");
  if (items.length === 0 && !onAdd) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    // min-h-[168px]: the WhoIsHere/MediaShelf quirk (real Chromium only,
    // never happy-dom - this file's own header comment on the identical
    // fix elsewhere) - an overflow-x-auto flex row's automatic min-
    // height computes to zero, collapsing the whole shelf to a sliver
    // with nothing in the a11y/overflow checks catching it visually,
    // only the screenshot pipeline's own dedicated clippedStrips check
    // (found live, HOME-UI-02d: home-phone-dark.png's own "Conversations"
    // shelf rendered as a near-invisible dashed line instead of its own
    // cards). 168px is a safe floor for the cards' own h-auto content
    // (a 20px icon or two text lines, plus p-4/p-3 padding) - real
    // content can still grow the row taller; this only guards the
    // collapse-to-zero failure mode.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable shelf, not a widget (DetailPane.tsx's own precedent).
    <div tabIndex={0} className={cn("flex min-h-[168px] gap-3 overflow-x-auto pb-1", FOCUS_RING)}>
      {onAdd ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onAdd}
          aria-label={addLabel}
          className="h-auto w-40 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-4 font-normal text-muted-foreground"
        >
          <PlusIcon className="size-5" aria-hidden />
          <span className="text-sm">{addLabel}</span>
        </Button>
      ) : null}
      {items.map((item) => (
        <Button
          key={item.key}
          type="button"
          variant="ghost"
          onClick={item.onClick}
          className="h-auto w-40 shrink-0 flex-col items-start justify-end gap-1 rounded-2xl border bg-[var(--surface-card)] p-3 text-left font-normal"
        >
          <span className="line-clamp-2 text-sm font-medium">{item.label}</span>
          {/* Deliberate type-floor exception (docs/UI.md, lane 7 item
              3): a shelf card's own compact time/subtitle line. */}
          <span className="text-xs text-muted-foreground">{item.sublabel}</span>
        </Button>
      ))}
    </div>
  );
}

function PhoneConversationsShelf() {
  const navigate = useNavigate();
  const query = useQuery<ConversationSummary[]>({ queryKey: ["conversations-list", null, ""], queryFn: () => api.conversationList() });
  const recent = [...(query.data ?? [])].filter((c) => c.last_turn_at).sort((a, b) => b.last_turn_at!.localeCompare(a.last_turn_at!)).slice(0, 8);
  const items: ShelfItem[] = recent.map((c) => ({
    key: c.id,
    label: c.title ?? "A conversation",
    sublabel: relativeTime(c.last_turn_at!),
    onClick: () => navigate(`/chat?conversation=${c.id}`),
  }));
  return <PhoneShelf items={items} onAdd={() => navigate("/chat")} addLabel="New chat" emptyText="No conversations yet." />;
}

function PhoneMemoriesShelf({ selfId }: { selfId: string }) {
  const navigate = useNavigate();
  const query = useQuery<MemoryRecord[]>({ queryKey: ["memory-list", "me"], queryFn: () => api.memories() });
  const recent = [...(query.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
  const items: ShelfItem[] = recent.map((m) => ({
    key: m.id,
    label: m.text,
    sublabel: relativeTime(m.created_at),
    onClick: () => navigate(`/people/${selfId}?tab=memories`),
  }));
  return <PhoneShelf items={items} emptyText="Nothing remembered yet." />;
}

// The two-column dark app-card grid: a 24px icon top-left, a bold
// title, one secondary line, a small state badge top-right when there
// is a real state to show (no live per-tile state exists for a package
// yet, same honest gap `AppsRow` above notes - the badge is simply
// omitted rather than invented).
function PhoneAppCards({ tiles, onSelect }: { tiles: StripTile[]; onSelect: (t: StripTile) => void }) {
  if (tiles.length === 0) {
    return <p className="text-sm text-muted-foreground">Pin your go-to apps from the app library.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <Button
          key={t.key}
          type="button"
          variant="ghost"
          onClick={() => onSelect(t)}
          className="h-auto flex-col items-start gap-2 rounded-2xl border bg-[var(--surface-pane)] p-4 text-left font-normal"
        >
          <IconTile icon={t.kind === "app" ? t.icon : "package"} hue={t.kind === "app" ? "--hue-blue" : "--hue-teal"} size="sm" glow={false} />
          <span className="truncate text-base font-semibold">{t.kind === "app" ? t.label : t.title}</span>
          {/* Deliberate type-floor exception (docs/UI.md, lane 7 item
              3): the app card's own compact kind line. */}
          <span className="text-xs text-muted-foreground">{t.kind === "app" ? "App" : "Package"}</span>
        </Button>
      ))}
    </div>
  );
}

function PhoneDashboard({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const { pinned } = usePinnedApps(person.id);
  const appTiles: StripTile[] = favoriteApps(pinned).map((e) => ({ kind: "app", key: `app-${e.to}`, to: e.to, icon: e.icon as IconName, label: e.label }));
  const widgetsQuery = useQuery<WidgetDescriptor[]>({ queryKey: ["widgets"], queryFn: () => api.widgets() });
  const packageTiles: StripTile[] = (widgetsQuery.data ?? []).map((w) => ({ kind: "package", key: `pkg-${w.package}-${w.id}`, title: w.title }));
  const tiles = [...appTiles, ...packageTiles];
  return (
    <>
      <PhoneHeroCard person={person} />
      <div className="mt-4">
        <PhoneMetricStrip person={person} />
      </div>
      <PhoneSectionHeader title="Conversations" subtitle="Pick up where you left off." />
      <PhoneConversationsShelf />
      <PhoneSectionHeader title="Recent memories" subtitle="What MaiPai has remembered lately." />
      <PhoneMemoriesShelf selfId={person.id} />
      <PhoneSectionHeader title="Your apps" subtitle="Everything you've pinned." />
      <PhoneAppCards tiles={tiles} onSelect={(t) => navigate(t.kind === "app" ? t.to : "/apps")} />
    </>
  );
}

export function HomePage({ person }: HomePageProps) {
  // hideTitle: the fixed header (spec "Current destination header
  // rule") now owns the destination's title and subtitle, including the
  // signed-in person's own greeting (shell/routeHeader.ts) - a second
  // one here would be exactly the duplicate header that rule forbids.
  //
  // Phone gets its own composition, not the desktop's panels shrunk
  // down (owner reference, "The phone composition," "Phone density,"
  // 2026-09-20) - `usePhoneMode()` is the same real breakpoint context
  // ThingsTable/FilterColumn already read (`PhoneModeContext`, wired to
  // a live breakpoint since HOME-UI-02), not a second detector.
  const phone = usePhoneMode();
  return (
    <Page title="Home" hideTitle>
      {/* A keyboard-scrollable region, not a widget (DetailPane.tsx's
          own precedent). Studio (owner ruling, "Two looks, one
          setting"): "the content area fills the pane edge to edge with
          a 24px gutter and no max-width column" plus the reference's
          own subtle canvas gradient - the dashboard's own wrapper, not
          every page's, since the ruling's acceptance judges this one
          route. Phone: 16px gutter, no canvas gradient (the ruling's
          own phone density rules name 16px/12px/20px rhythm, not the
          desktop treatment). Unconditional edge-to-edge since LOOK-01
          (2026-09-21) retired the look-scoped `studio:` variant this
          used to render behind (checked live in the built CSS: no
          media-query scope of its own, so it applied at every non-
          phone width whenever active) and the centered-column fallback
          it overrode - already every fresh person's own default, so
          nothing on screen moves. */}
      <div
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see the comment above.
        tabIndex={0}
        style={{ background: phone ? undefined : "var(--canvas-background)" }}
        className={cn(
          "flex min-h-0 w-full max-w-none flex-1 flex-col overflow-y-auto",
          phone ? "gap-5 px-4 py-4" : "gap-6 px-6 py-6",
          FOCUS_RING,
        )}
      >
        {phone ? (
          <PhoneDashboard person={person} />
        ) : (
          <>
            <MetricRow person={person} />

            <div className="grid gap-3 lg:grid-cols-2">
              <TodayPanel />
              <RecentMemoriesPanel selfId={person.id} />
            </div>

            <YourAppsPanel person={person} />

            <div className="grid gap-3 lg:grid-cols-3">
              <PeoplePanel selfId={person.id} />
              <ActivityPanel />
              <QuickActionsPanel person={person} />
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
