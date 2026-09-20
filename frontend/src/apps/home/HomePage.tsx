import { favoriteApps } from "@/shell/appCatalog";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Trans } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { cn, FOCUS_RING } from "@maipai/ui/src/utils";
import { Card } from "@maipai/ui/src/primitives/Card";
import { CardGrid } from "@maipai/ui/src/primitives/CardGrid";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Button } from "@maipai/ui/src/ui/button";
import { Command, CommandInput, CommandList } from "@maipai/ui/src/ui/command";
import { getIcon } from "@maipai/ui/src/icons";
import { CardSizeSlider, useCardSize, cardSizeStyle } from "@maipai/ui/src/primitives/CardSizeSlider";
import { NodeRenderer } from "@maipai/ui/src/schema/NodeRenderer";
import type { WidgetCardNode } from "@maipai/ui/src/schema/types";
import { api, type Roster, type PersonRosterEntry, type ResolvedSetting } from "@/lib/api";
import { greetingFor } from "@/apps/home/greeting";
import { runFixedTurn } from "@/apps/home/runFixedTurn";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useSearchCommand } from "@/shell/search/useSearchCommand";
import { SearchResultGroups } from "@maipai/ui/src/search/SearchResultGroups";
import type { SearchResultItem } from "@/shell/search/providers";
import { weatherCardQuestion } from "@maipai/home-backend/src/homeCardQuestions";

// The one widget_card instance Home mounts (docs/plans/session-e-ui-and-
// docs.md step 2). Home is still hand-written React, not a JSON page, so
// this is mounted directly rather than through a page document's `body` -
// the same way ExternallyMountedNodeView's two cases are reached by
// their own page components, not through a page render.
const PACKAGE_WIDGET_CARDS: WidgetCardNode = { type: "widget_card", bind: { source: "route", path: "/api/widgets", stream: false } };

interface HomePageProps {
  person: Roster;
}

// Home cards render its own answer, or say nothing (docs/UI.md: a failed
// card is a quiet gap in "today", never a red error banner on the one
// page every visit starts from).
function TodayCard({ icon, title, action, children }: { icon: string; title: string; action?: ReactNode; children: ReactNode }) {
  const Icon = getIcon(icon);
  return (
    <Card label={title} className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon aria-hidden className="size-4" />
          <span>{title}</span>
        </div>
        {action}
      </div>
      <div className="mt-2 text-base">{children}</div>
    </Card>
  );
}

// Shares the Settings page's own cache entry for this scope
// (SettingsRenderer.tsx: `["settings-values", scopeValue]`) rather than a
// second fetch of the same household settings, and shared here by
// WeatherCard and Tagline rather than each declaring an identical
// `useQuery` of their own (code review, 2026-09-11) - one definition, so
// a future change to this read (staleTime, retry policy) can't drift
// between the two call sites. A household changes its own settings
// rarely, hence the 5-minute staleTime.
function useHouseholdSettings() {
  return useQuery({
    queryKey: ["settings-values", "household"],
    queryFn: () => api.settingsValues("household"),
    staleTime: 5 * 60 * 1000,
  });
}

// The same "find by key, only trust a non-empty string" read WeatherCard
// and Tagline each need for their own household setting - one definition
// (code review, 2026-09-11) rather than the identical inline find()
// typed out twice.
function textSetting(values: ResolvedSetting[] | undefined, key: string): string | undefined {
  const value = values?.find((s) => s.key === key)?.value;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function WeatherCard() {
  // Found live 2026-09-11: with no place in the fixed utterance below, a
  // place-free turn left the model to guess a `place` argument on its
  // own, which produced the literal word "here" - and Open-Meteo
  // genuinely has a village named that. `household.home_place`
  // (backend/src/settings/coreKeys.ts) gives this card a real place to
  // ask about once the household has set one.
  const settingsQuery = useHouseholdSettings();
  const place = textSetting(settingsQuery.data, "household.home_place");
  const question = weatherCardQuestion(place);
  // Cached by the query layer (step 6: "calling the weather plugin
  // through the existing turn route with a fixed utterance, cached by
  // the query layer") - a real turn through the shared engine, not a
  // separate widget backend, per the plugin model every package uses.
  // 30 minutes: often enough that "today" never looks stale, rare enough
  // that opening Home repeatedly in a session doesn't create a new turn
  // (and a new conversation-history row) every time. Gated on the
  // settings read landing first, so this never fires once with the
  // place-free question and again once the place is known - each visit
  // asks exactly one question.
  const query = useQuery({
    queryKey: ["home-turn", "weather", question],
    queryFn: () => runFixedTurn(question),
    staleTime: 30 * 60 * 1000,
    retry: false,
    enabled: !settingsQuery.isPending,
  });
  return (
    <TodayCard icon="sparkles" title="Weather">
      {settingsQuery.isPending || query.isLoading ? "Checking..." : (query.data ?? "Couldn't check the weather right now.")}
    </TodayCard>
  );
}

function RecentMemoriesCard() {
  const navigate = useNavigate();
  // The same `["memory-list", "me"]` key MemoryPage.tsx's own
  // `OwnMemories` uses for the actor's own list - one cache entry, not a
  // second fetch, and forgetting or archiving a memory anywhere
  // invalidates this card too (lane 3 item 4, 2026-09-13: this key was
  // `["schema-binding", "/api/memory"]` while MemoryPage's default view
  // was schema-page-driven; it moved to hand-written for real batch
  // forget, and this card's key moved with it, or the two would silently
  // stop sharing a cache entry). Sliced to "recent" client-side
  // (`created_at` descending): the contract's own `GET /api/memory?since=`
  // (session-a-intelligence.md) isn't on `main` yet, so this is the same
  // "local mock until the real route lands" the conversations adapter
  // already uses, not a second design.
  const query = useQuery({
    queryKey: ["memory-list", "me"],
    queryFn: () => api.memories(),
  });
  const recent = [...(query.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);
  return (
    <TodayCard
      icon="brain"
      title="Recent memories"
      action={
        <Button variant="ghost" size="sm" onClick={() => navigate("/memory")}>
          View all →
        </Button>
      }
    >
      {recent.length === 0 ? (
        "Nothing remembered yet."
      ) : (
        <ul className="flex flex-col gap-1">
          {recent.map((m) => (
            <li key={m.id} className="truncate">
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </TodayCard>
  );
}

// "Who is here" (step 6): the household roster, not live presence - no
// session/presence infrastructure exists yet (docs/BACKLOG.md's own note,
// "presence unknown for now"). Showing who lives here is still real and
// useful on its own; it just isn't "who is home right now" yet.
function WhoIsHere({ selfId }: { selfId: string }) {
  const query = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: api.people });
  const people = query.data ?? [];
  if (people.length === 0) return null;
  return (
    // `shrink-0 min-h-[72px]`: `overflow-x-auto` computes `overflow-y` to
    // `auto` too (MediaShelf.tsx's own comment on the identical quirk,
    // 2026-09-05), which makes this row's own automatic minimum size (a
    // flex item's `min-height: auto` resolves to 0, not its content
    // size, once it establishes a scroll container) collapse to zero
    // inside this page's own `flex-col` layout - a real bug found live,
    // 2026-09-13: every name under an avatar rendered fully clipped, cut
    // off at the very top of each letter, in the published home
    // screenshot. `min-h-[72px]` (the 40px avatar, the label's own
    // ~24px line height at `text-base`'s default leading, and the 4px
    // gap between them, with a little rounding room) gives the row a
    // real height that doesn't depend on the browser's own automatic
    // sizing at all - recomputed lane 7 item 3 (2026-09-13) when the
    // label below moved off `text-xs` to the type floor, from the
    // original `min-h-16` (64px) tuned for that smaller label's own
    // ~20px line height. This is the same quirk MediaShelf.tsx's own
    // scroll rail already documents (worked around there with padding,
    // for a different symptom - focus-ring clipping, not a height
    // collapse, since that rail isn't usually a `flex-col` item the way
    // this row is) -  a code review, 2026-09-13, flagged that the two
    // fixes are two different techniques for the identical root cause
    // with nothing centralizing it; noted rather than unified here
    // (scripts/screenshot.ts's own `clippedStrips` check, added in the
    // same commit as this fix, is the runtime backstop for a THIRD
    // instance turning up before anyone gets to that).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent).
    <div tabIndex={0} className={cn("flex min-h-[72px] shrink-0 items-center gap-2 overflow-x-auto", FOCUS_RING)}>
      {people.map((p) => (
        <div key={p.id} className="flex shrink-0 flex-col items-center gap-1">
          <Avatar name={p.display_name} className="h-10 w-10 text-sm" />
          {/* text-base, not text-xs: the type floor (docs/UI.md), lane 7 item 3. */}
          <span className="text-base text-muted-foreground">{p.id === selfId ? "You" : p.display_name}</span>
        </div>
      ))}
    </div>
  );
}

// Found live 2026-09-11: the header hardcoded this generic line with no
// way for a household to make the page its own.
const DEFAULT_TAGLINE = "Made for your everyday";

function Tagline() {
  const query = useHouseholdSettings();
  const familyName = textSetting(query.data, "household.family_name");
  const text = familyName ? `${familyName} Family` : DEFAULT_TAGLINE;
  // text-base, not text-xs: the type floor (docs/UI.md), lane 7 item 3.
  return <p className="mb-2 text-base font-medium tracking-widest text-primary uppercase">{text}</p>;
}

function PinnedAppsStrip({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const { pinned } = usePinnedApps(person.id);
  const entries = favoriteApps(pinned);
  return (
    <CardGrid
      label="Pinned apps"
      items={entries}
      getKey={(e) => e.to}
      getLabel={(e) => e.label}
      onSelect={(e) => navigate(e.to)}
      emptyState={{ icon: "pin", text: "Pin your go-to apps from the app library." }}
      renderItem={(e) => {
        const Icon = getIcon(e.icon);
        return (
          <div className="flex flex-col items-center gap-2 p-4">
            <Icon aria-hidden className="size-6" />
            <span className="text-sm">{e.label}</span>
          </div>
        );
      }}
    />
  );
}

// Lane 9 item 1: "one prompt box that is both search and chat" - the
// exact same shared query (`useSearchCommand`, `SearchResultGroups`)
// `CommandPalette.tsx`'s Cmd/Ctrl+K dialog uses, laid out inline on the
// page instead of a modal (docs/BACKLOG.md: "the same prompt box the
// home-screen item above describes; build it once"). Typing shows
// matches (apps, memories, conversations, and more); Enter with nothing
// deliberately arrowed to sends the raw text to chat, exactly as the
// plain box already did - `SearchResultGroups`'s own "Ask" row renders
// first, so cmdk's own default-highlight-first-item behavior lands
// there unless a person arrows down to a real match first.
function HomeSearchPrompt({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { visibleGroups, trimmed } = useSearchCommand(person.id, query);

  function select(item: SearchResultItem) {
    navigate(item.to, item.state ? { state: item.state } : undefined);
    setQuery("");
  }

  function askMaiPai() {
    if (!query.trim()) return;
    navigate("/chat", { state: { initialText: query } });
    setQuery("");
  }

  return (
    <Command
      shouldFilter={false}
      // `shrink-0 h-auto!`, not `Command`'s own `size-full`: two
      // separate bugs found live, 2026-09-13, from the SAME root cause
      // (`Command`'s base class carries `size-full overflow-hidden`,
      // meant for `CommandDialog`'s always-sized `DialogContent`, wrong
      // for this inline box's real parent - a plain flow div inside an
      // `overflow-y-auto flex-col` scroll container). Bug 1: with only
      // the default `flex-shrink: 1`, the flex algorithm shrank the
      // whole box to a few px regardless of content (the identical
      // "overflow-hidden zeroes a flex item's own automatic minimum
      // size" quirk WhoIsHere/MediaShelf already document) - a height
      // override alone did nothing, since shrinking overrides an
      // explicit height. Bug 2: `shrink-0` alone fixed that, but then
      // exposed `size-full`'s OWN `height: 100%` computing against the
      // scroll container's real height (~650px), stretching the box
      // and pushing every card below it out of view. Both together are
      // the real fix - `h-auto!` (forced: a plain `h-auto` alone
      // survived in the class list next to `size-full` rather than
      // replacing it, `cn()`'s twMerge not treating them as
      // conflicting, and lost the cascade to `.size-full` either way).
      className="h-auto! shrink-0 rounded-2xl! border border-border/70 bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/30"
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder="Ask MaiPai anything..." aria-label="Ask MaiPai" />
      {/* `CommandList` always mounted, not conditional on `trimmed`: found
          live, 2026-09-13 - cmdk's own `CommandInput` always carries
          `aria-controls` pointing at the list's id regardless, so
          unmounting the list on an empty query left that id dangling
          (axe's aria-valid-attr-value, critical). Results stay
          conditional on `trimmed`, matching Home's own "no dropdown
          clutter until you type" intent (the strip below already shows
          pinned apps) - only the list ELEMENT itself needs to always
          exist, not its contents. */}
      <CommandList>{trimmed !== "" ? <SearchResultGroups groups={visibleGroups} trimmedQuery={trimmed} onSelect={select} onAsk={askMaiPai} askLabel="Ask MaiPai" /> : null}</CommandList>
    </Command>
  );
}

export function HomePage({ person }: HomePageProps) {
  const navigate = useNavigate();
  const [cardSize, setCardSize] = useCardSize("home");

  // hideTitle: the greeting right below already gives this page its
  // identity (name + time of day) - a second, generic "Home" label above
  // it would be pure redundancy, unlike Settings (Page.tsx's own default
  // case), which had no visible identity at all before this step.
  return (
    <Page title="Home" hideTitle>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-8 overflow-y-auto px-4 py-6 sm:px-8", FOCUS_RING)}>
        <div>
          <Tagline />
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{greetingFor(new Date(), person.display_name)}</h2>
        </div>

        <WhoIsHere selfId={person.id} />

        <HomeSearchPrompt person={person} />

        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            <Trans id="Today" message="Today" />
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <WeatherCard />
            <RecentMemoriesCard />
          </div>
        </div>

        <div style={cardSizeStyle(cardSize)}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">Your packages</h3>
            <CardSizeSlider size={cardSize} onChange={setCardSize} />
          </div>
          <NodeRenderer node={PACKAGE_WIDGET_CARDS} />
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">Favorites</h3>
            <Button variant="ghost" size="sm" onClick={() => navigate("/apps")}>Browse apps →</Button>
          </div>
          <PinnedAppsStrip person={person} />
        </div>
      </div>
    </Page>
  );
}
