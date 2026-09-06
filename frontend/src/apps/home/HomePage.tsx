import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
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
import { NAV_ENTRIES } from "@/shell/nav";

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
function TodayCard({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  const Icon = getIcon(icon);
  return (
    <Card label={title} className="p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon aria-hidden className="size-4" />
        <span>{title}</span>
      </div>
      <div className="mt-2 text-base">{children}</div>
    </Card>
  );
}

function WeatherCard() {
  // Cached by the query layer (step 6: "calling the weather plugin
  // through the existing turn route with a fixed utterance, cached by
  // the query layer") - a real turn through the shared engine, not a
  // separate widget backend, per the plugin model every package uses.
  // 30 minutes: often enough that "today" never looks stale, rare enough
  // that opening Home repeatedly in a session doesn't create a new turn
  // (and a new conversation-history row) every time.
  const query = useQuery({
    queryKey: ["home-turn", "weather"],
    queryFn: () => runFixedTurn("What's the weather like today?"),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  return (
    <TodayCard icon="sparkles" title="Weather">
      {query.isLoading ? "Checking..." : (query.data ?? "Couldn't check the weather right now.")}
    </TodayCard>
  );
}

function RecentMemoriesCard() {
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
    <TodayCard icon="brain" title="Recent memories">
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
    <div className="flex items-center gap-2 overflow-x-auto">
      {people.map((p) => (
        <div key={p.id} className="flex shrink-0 flex-col items-center gap-1">
          <Avatar name={p.display_name} className="h-10 w-10 text-sm" />
          <span className="text-xs text-muted-foreground">{p.id === selfId ? "You" : p.display_name}</span>
        </div>
      ))}
    </div>
  );
}

function PinnedAppsStrip({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const { pinned } = usePinnedApps(person.id);
  const entries = NAV_ENTRIES.filter((e) => pinned.includes(e.to));
  return (
    <CardGrid
      label="Pinned apps"
      items={entries}
      getKey={(e) => e.to}
      getLabel={(e) => e.label}
      onSelect={(e) => navigate(e.to)}
      emptyState={{ icon: "pin", text: "Pin an app from its header to see it here." }}
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
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <div>
          <h2 className="text-2xl font-semibold">{greetingFor(new Date(), person.display_name)}</h2>
        </div>

        <WhoIsHere selfId={person.id} />

        <form onSubmit={submitPrompt} className="flex gap-2">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask MaiPai anything..."
            aria-label="Ask MaiPai"
            className="flex-1"
          />
          <Button type="submit">Ask</Button>
        </form>

        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Today</h3>
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
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Your apps</h3>
          <PinnedAppsStrip person={person} />
        </div>
      </div>
    </Page>
  );
}
