import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Card } from "@maipai/ui/src/primitives/Card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AnswerBlockView } from "@maipai/ui/src/elements/answer-block";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { api, type HomeWidgets, type WidgetData, type WidgetDescriptor } from "@/lib/api";

/** Design note section 6: never more than four Today cards before "More". */
export const TODAY_CARD_BUDGET = 4;
const displayTitle = (widget: WidgetDescriptor) => widget.package === "almanac-date" && widget.id === "today" ? i18n._({ id: "Coming up", message: "Coming up" }) : widget.title;

interface Slot { widget: WidgetDescriptor; data: WidgetData }

/** A card with nothing real to say (still loading, a failed read, no items, or a handler's fallback text)
 * is left out quietly: rule 6, a failed tool never fails the page. */
export function todaySlots(widgets: WidgetDescriptor[], results: Array<{ isPending: boolean; data?: WidgetData }>): Slot[] {
  const slots: Slot[] = [];
  widgets.forEach((widget, index) => {
    const result = results[index];
    if (!result) return;
    if (!result.isPending && result.data && result.data.items.length > 0 && !result.data.degraded) slots.push({ widget, data: result.data });
  });
  return slots;
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
  const slots = todaySlots(widgets, results);
  const heroQuery = useQuery({ queryKey: ["home-hero"], queryFn: () => home?.hero ? api.widgetData(home.hero.package, home.hero.id) : Promise.resolve(undefined), enabled: Boolean(home?.hero), retry: false });

  if (!home && list.isPending) return <RouteSkeleton label={i18n._({ id: "Loading Today", message: "Loading Today" })} />;
  if (!home && list.isError) return <p role="alert" className="text-sm text-muted-foreground">{i18n._({ id: "Could not load Today. Refresh Home to try again.", message: "Could not load Today. Refresh Home to try again." })}</p>;
  const visibleSlots = slots.filter((slot) => {
    const item = slot.data.items.length === 1 ? slot.data.items[0] : undefined;
    const sentenceOnlyEmpty = Boolean(item && !item.value && !item.subtitle && (
      (slot.widget.package === "news" && item.title.startsWith("No news lists are turned on")) ||
      (slot.widget.package === "remind" && slot.widget.id === "shopping" && item.title === "Your shopping list is empty.")
    ));
    return !sentenceOnlyEmpty || isOwnerOrAdminRole(role ?? "guest");
  });
  if (visibleSlots.length === 0) return null;

  const cards = (shown: Slot[]) => shown.map((slot) => slot.data.card ? (
    // The kit's compact weather card is its own card; the text Card is the fallback when no block came back.
    <div key={`${slot.widget.package}/${slot.widget.id}`} data-testid="home-today-card">
      <AnswerBlockView block={slot.data.card} compact />
    </div>
  ) : (
      <div key={`${slot.widget.package}/${slot.widget.id}`} data-testid="home-today-card"><Card surface="flat">
        <div className="text-row font-semibold">{displayTitle(slot.widget)}</div>
        <ItemGroup>
          {slot.data.items.map((item, index) => (
              <Item key={`${item.title}-${index}`} size="sm" role="listitem">
              <ItemContent>
                <ItemTitle className="text-row font-semibold">{item.title}</ItemTitle>
                {item.subtitle ? <ItemDescription className="text-supporting">{item.subtitle}</ItemDescription> : null}
              </ItemContent>
              {item.value ? <ItemActions>{item.value}</ItemActions> : null}
            </Item>
          ))}
        </ItemGroup>
      </Card></div>
  ));

  if (chips) {
    // Ask first: each Today card is one chip; a tap opens that full card under the row, a second tap closes it.
    const key = (slot: Slot) => `${slot.widget.package}/${slot.widget.id}`;
    const opened = visibleSlots.find((slot) => key(slot) === open);
    return (
      <section aria-label={i18n._({ id: "Today", message: "Today" })} className="flex flex-col gap-3 lg:col-span-12">
        <h2 className="text-base leading-snug font-medium">{i18n._({ id: "Today", message: "Today" })}</h2>
        <div className="flex flex-nowrap gap-2 overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleSlots.map((slot) => (
            <Chip key={key(slot)} tone="surface" size="strip" selected={open === key(slot)} selectedTone="inverse" aria-expanded={open === key(slot)} onClick={() => setOpen(open === key(slot) ? null : key(slot))}>{displayTitle(slot.widget)}</Chip>
          ))}
        </div>
        {opened ? <div className="max-w-xl">{cards([opened])}</div> : null}
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
    <section aria-label={i18n._({ id: "Today", message: "Today" })} className="flex flex-col gap-3 lg:col-span-12">
      <h2 className="text-base leading-snug font-medium">{i18n._({ id: "Today", message: "Today" })}</h2>
      <div className="flex gap-3 overflow-x-auto [&>*]:w-72 [&>*]:shrink-0 lg:[&>*]:w-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-3 lg:flex-wrap lg:overflow-visible">{cards(first)}</div>
      {rest.length === 0 ? null : (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="outline" size="row" />}>{i18n._({ id: "More", message: "More" })}</CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex gap-3 overflow-x-auto pt-3 [&>*]:w-72 [&>*]:shrink-0 lg:[&>*]:w-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-3 lg:flex-wrap lg:overflow-visible">{cards(rest)}</div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
    </>
  );
}
