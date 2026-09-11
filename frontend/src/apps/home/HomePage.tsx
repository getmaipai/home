import { favoriteApps } from "@/shell/appCatalog";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Trans } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
import { cn, FOCUS_RING } from "@/kit/utils";
import { Card } from "@/kit/primitives/Card";
import { CardGrid } from "@/kit/primitives/CardGrid";
import { Avatar } from "@/kit/primitives/Avatar";
import { Input } from "@/kit/ui/input";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { CardSizeSlider, useCardSize, cardSizeStyle } from "@/kit/primitives/CardSizeSlider";
import { NodeRenderer } from "@/kit/schema/NodeRenderer";
import type { WidgetCardNode } from "@/kit/schema/types";
import { api, type Roster, type PersonRosterEntry } from "@/lib/api";
import { greetingFor } from "@/apps/home/greeting";
import { runFixedTurn } from "@/apps/home/runFixedTurn";
import { usePinnedApps } from "@/shell/usePinnedApps";

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

function WeatherCard() {
  // Found live 2026-09-11: with no place in the fixed utterance below, a
  // place-free turn left the model to guess a `place` argument on its
  // own, which produced the literal word "here" - and Open-Meteo
  // genuinely has a village named that. `household.home_place`
  // (backend/src/settings/coreKeys.ts) gives this card a real place to
  // ask about once the household has set one.
  const settingsQuery = useHouseholdSettings();
  const place = settingsQuery.data?.find((s) => s.key === "household.home_place")?.value;
  const question = typeof place === "string" && place.length > 0 ? `What's the weather like in ${place} today?` : "What's the weather like today?";
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
  // The same `["schema-binding", "/api/memory"]` key MemoryPage.tsx and
  // its own actions already use (kit/schema/binding.ts's convention) -
  // one cache entry, not a second fetch, and archiving a memory anywhere
  // invalidates this card too. Sliced to "recent" client-side
  // (`created_at` descending): the contract's own `GET /api/memory?since=`
  // (session-a-intelligence.md) isn't on `main` yet, so this is the same
  // "local mock until the real route lands" the conversations adapter
  // already uses, not a second design.
  const query = useQuery({
    queryKey: ["schema-binding", "/api/memory"],
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
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent).
    <div tabIndex={0} className={cn("flex items-center gap-2 overflow-x-auto", FOCUS_RING)}>
      {people.map((p) => (
        <div key={p.id} className="flex shrink-0 flex-col items-center gap-1">
          <Avatar name={p.display_name} className="h-10 w-10 text-sm" />
          <span className="text-xs text-muted-foreground">{p.id === selfId ? "You" : p.display_name}</span>
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
  const familyName = query.data?.find((s) => s.key === "household.family_name")?.value;
  const text = typeof familyName === "string" && familyName.length > 0 ? `${familyName} Family` : DEFAULT_TAGLINE;
  return <p className="mb-2 text-xs font-medium tracking-widest text-primary uppercase">{text}</p>;
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

export function HomePage({ person }: HomePageProps) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [cardSize, setCardSize] = useCardSize("home");

  function submitPrompt(e: FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    navigate("/chat", { state: { initialText: text } });
  }

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

        <form onSubmit={submitPrompt} className="flex gap-2 rounded-2xl border border-border/70 bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask MaiPai anything..."
            aria-label="Ask MaiPai"
            className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button type="submit">Ask</Button>
        </form>

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
