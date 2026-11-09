import { i18n } from "@lingui/core";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Card } from "@maipai/ui/src/primitives/Card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AnswerBlockView } from "@maipai/ui/src/elements/answer-block";
import { Section } from "@maipai/ui/src/primitives/Section";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { formatRelativeLong } from "@/lib/format";
import { api, type HomeWidgets, type WidgetData, type WidgetDescriptor } from "@/lib/api";

/** Design note section 6: never more than four Today cards before "More". */
export const TODAY_CARD_BUDGET = 4;
const displayTitle = (widget: WidgetDescriptor) => widget.package === "almanac-date" && widget.id === "today" ? i18n._({ id: "Coming up", message: "Coming up" })
  : widget.package === "remind" && widget.id === "upcoming" ? i18n._({ id: "Next up", message: "Next up" })
  : widget.package === "timer" && widget.id === "running" ? i18n._({ id: "Timers", message: "Timers" })
  : widget.title;

/** A value too long to sit beside its title (a headline digest) is drawn as a line under it instead. */
const longValue = (value: unknown): boolean => typeof value === "string" && value.length > 24;

interface Slot { widget: WidgetDescriptor; data: WidgetData; stale: boolean }

const slotKey = (widget: WidgetDescriptor) => `${widget.package}/${widget.id}`;

/** A card with nothing real to say (still loading, no items, or a handler's fallback text with no earlier data) is left out
 * quietly: rule 6, a failed tool never fails the page. A card that had real data before and now fails or comes back
 * degraded keeps its last data, marked stale, so it does not vanish; `lastGood` holds that data per card. An answer that is
 * simply empty hides the card and forgets the old data. */
export function todaySlots(widgets: WidgetDescriptor[], results: Array<{ isPending: boolean; isError?: boolean; data?: WidgetData }>, lastGood: Map<string, WidgetData> = new Map()): Slot[] {
  const slots: Slot[] = [];
  widgets.forEach((widget, index) => {
    const result = results[index];
    if (!result || result.isPending) return;
    const key = slotKey(widget);
    const fresh = result.data && !result.data.degraded && result.data.items.length > 0 ? result.data : undefined;
    if (fresh) {
      if (!result.isError) lastGood.set(key, fresh);
      slots.push({ widget, data: fresh, stale: Boolean(result.isError) });
      return;
    }
    const failed = Boolean(result.isError) || !result.data || Boolean(result.data.degraded);
    if (!failed) { lastGood.delete(key); return; }
    const before = lastGood.get(key);
    if (before) slots.push({ widget, data: before, stale: true });
  });
  return slots;
}

/** A card is "old" once its data is more than three refresh intervals behind (or a refresh just failed). */
export function isCardOld(widget: WidgetDescriptor, data: WidgetData, stale: boolean, now: number = Date.now()): boolean {
  if (stale) return true;
  const age = now - Date.parse(data.as_of);
  return Number.isFinite(age) && age > 3 * widget.refresh_s * 1000;
}

/** HOME-ALIVE-01e: one card per widget the viewer's role clears (the server already filtered by role and age). */
export function TodaySection({ home, heroOnly = false, chips = false, role }: { home?: HomeWidgets; heroOnly?: boolean; chips?: boolean; role?: Roster["role"] }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["home-widgets"], queryFn: api.homeWidgets, retry: false, enabled: !home });
  const ordered = home ?? list.data;
  const slotsByOrder = ordered ? [...(ordered.cards ?? []), ...(ordered.more ?? [])] : [];
  const widgets = Array.isArray(slotsByOrder) ? slotsByOrder : [];
  const results = useQueries({
    queries: widgets.map((widget) => ({
      queryKey: ["widget-data", widget.package, widget.id],
      queryFn: () => api.widgetData(widget.package, widget.id),
      refetchInterval: Math.max(widget.refresh_s, 30) * 1000,
      retry: false,
    })),
  });
  const lastGood = useRef(new Map<string, WidgetData>());
  const slots = todaySlots(widgets, results, lastGood.current);
  const heroQuery = useQuery({ queryKey: ["home-hero"], queryFn: () => home?.hero ? api.widgetData(home.hero.package, home.hero.id) : Promise.resolve(undefined), enabled: Boolean(home?.hero), retry: false });

  if (!home && list.isPending) return <RouteSkeleton label={i18n._({ id: "Loading Today", message: "Loading Today" })} />;
  if (!home && list.isError) return <p role="alert" className="text-supporting text-muted-foreground">{i18n._({ id: "Could not load Today. Refresh Home to try again.", message: "Could not load Today. Refresh Home to try again." })}</p>;
  const visibleSlots = slots.filter((slot) => {
    const item = slot.data.items.length === 1 ? slot.data.items[0] : undefined;
    const sentenceOnlyEmpty = Boolean(item && !item.value && !item.subtitle && (
      (slot.widget.package === "news" && item.title.startsWith("No news lists are turned on")) ||
      (slot.widget.package === "remind" && slot.widget.id === "shopping" && item.title === "Your shopping list is empty.")
    ));
    return !sentenceOnlyEmpty || isOwnerOrAdminRole(role ?? "guest");
  });
  if (visibleSlots.length === 0) return null;

  // A tap on the weather card opens the Weather app.
  const opensApp = (slot: Slot, content: ReactNode): ReactNode => slot.widget.package === "weather"
    ? <Link to="/apps/weather" aria-label={i18n._({ id: "Open Weather", message: "Open Weather" })} data-testid="home-today-link" className="block rounded-xl no-underline focus-visible:ring-2 focus-visible:ring-ring">{content}</Link>
    : content;
  // The quiet freshness line under a card's data: the muted tone, or the status-warning ink when the data is old.
  const freshness = (slot: Slot): ReactNode => Number.isFinite(Date.parse(slot.data.as_of)) ? (
    <p data-testid="home-today-updated" data-old={isCardOld(slot.widget, slot.data, slot.stale) ? "true" : undefined} className={`text-supporting ${isCardOld(slot.widget, slot.data, slot.stale) ? "text-status-warning-ink" : "text-muted-foreground"}`}>
      {i18n._({ id: "Updated {when}", message: "Updated {when}", values: { when: formatRelativeLong(slot.data.as_of) } })}
    </p>
  ) : null;
  const cards = (shown: Slot[]) => shown.map((slot) => slot.data.card ? (
    // The kit's compact weather card is its own card; the text Card is the fallback when no block came back.
    <div key={`${slot.widget.package}/${slot.widget.id}`} data-testid="home-today-card">
      {opensApp(slot, <AnswerBlockView block={slot.data.card} compact />)}
      {freshness(slot)}
    </div>
  ) : (
      <div key={`${slot.widget.package}/${slot.widget.id}`} data-testid="home-today-card">{opensApp(slot, <Card surface="flat">
        <div className="text-row font-semibold">{displayTitle(slot.widget)}</div>
        <ItemGroup>
          {slot.data.items.map((item, index) => (
              <Item key={`${item.title}-${index}`} size="sm" role="listitem">
              <ItemContent>
                <ItemTitle className="text-row font-semibold">{item.title}</ItemTitle>
                {item.subtitle ? <ItemDescription className="text-supporting">{item.subtitle}</ItemDescription> : null}
                {longValue(item.value) && !item.at ? <ItemDescription className="text-supporting">{item.value}</ItemDescription> : null}
              </ItemContent>
              {item.at || (item.value && !longValue(item.value)) ? <ItemActions>{item.at ? formatRelativeLong(item.at) : item.value}</ItemActions> : null}
            </Item>
          ))}
        </ItemGroup>
        {freshness(slot)}
      </Card>)}</div>
  ));

  if (chips) {
    // Ask first: each Today card is one chip; a tap opens that full card under the row, a second tap closes it.
    const key = (slot: Slot) => `${slot.widget.package}/${slot.widget.id}`;
    const opened = visibleSlots.find((slot) => key(slot) === open);
    return (
      <section aria-label={i18n._({ id: "Today", message: "Today" })} className="md:col-span-2 lg:col-span-12">
        <Section variant="flat" heading={i18n._({ id: "Today", message: "Today" })}>
        <div className="flex flex-nowrap gap-2 overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap [&::-webkit-scrollbar]:hidden">
          {visibleSlots.map((slot) => (
            <Chip key={key(slot)} tone="surface" size="strip" selected={open === key(slot)} selectedTone="inverse" aria-expanded={open === key(slot)} onClick={() => setOpen(open === key(slot) ? null : key(slot))}>{displayTitle(slot.widget)}</Chip>
          ))}
        </div>
        {opened ? <div className="max-w-xl">{cards([opened])}</div> : null}
        </Section>
      </section>
    );
  }

  const first = visibleSlots.slice(0, home ? home.cards.length : TODAY_CARD_BUDGET);
  const rest = visibleSlots.slice(TODAY_CARD_BUDGET);
  const heroData: WidgetData | undefined = heroQuery.data;
  const heroSlot = home?.hero && heroData && heroData.items.length > 0 && !heroData.degraded ? { widget: home.hero, data: heroData } : null;
  const showHeroSkeleton = heroOnly && Boolean(home?.hero) && heroQuery.isPending;
  if (showHeroSkeleton) return <RouteSkeleton label={i18n._({ id: "Loading Home highlight", message: "Loading Home highlight" })} />;
  if (heroOnly) return heroSlot ? <section aria-label={i18n._({ id: "Home highlight", message: "Home highlight" })} className="lg:col-span-4"><div data-testid="home-hero"><Card surface="flat"><div className="text-row font-semibold">{displayTitle(heroSlot.widget)}</div><ItemGroup>{heroSlot.data.items.map((item, index) => <Item key={`${item.title}-${index}`} size="sm"><ItemContent><ItemTitle>{item.title}</ItemTitle>{item.subtitle ? <ItemDescription className="text-supporting">{item.subtitle}</ItemDescription> : null}</ItemContent>{item.value ? <ItemActions>{item.value}</ItemActions> : null}</Item>)}</ItemGroup></Card></div></section> : null;
  return (
    <>
    {heroSlot ? <section aria-label={i18n._({ id: "Home highlight", message: "Home highlight" })} className="lg:col-span-4"><div data-testid="home-hero"><Card surface="flat"><div className="text-row font-semibold">{heroSlot.widget.title}</div><ItemGroup>{heroSlot.data.items.map((item, index) => <Item key={`${item.title}-${index}`} size="sm"><ItemContent><ItemTitle>{item.title}</ItemTitle>{item.subtitle ? <ItemDescription className="text-supporting">{item.subtitle}</ItemDescription> : null}</ItemContent>{item.value ? <ItemActions>{item.value}</ItemActions> : null}</Item>)}</ItemGroup></Card></div></section> : null}
    <section aria-label={i18n._({ id: "Today", message: "Today" })} className="md:col-span-2 lg:col-span-12">
      <Section variant="flat" heading={i18n._({ id: "Today", message: "Today" })}>
      <div className="flex snap-x gap-3 overflow-x-auto [&>*]:w-72 [&>*]:shrink-0 [&>*]:snap-start lg:[&>*]:w-auto [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-3 lg:flex-wrap lg:overflow-visible">{cards(first)}</div>
      {rest.length === 0 ? null : (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="outline" size="row" />}>{i18n._({ id: "More", message: "More" })}</CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex gap-3 overflow-x-auto pt-3 [&>*]:w-72 [&>*]:shrink-0 lg:[&>*]:w-auto [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-3 lg:flex-wrap lg:overflow-visible">{cards(rest)}</div>
          </CollapsibleContent>
        </Collapsible>
      )}
      </Section>
    </section>
    </>
  );
}
