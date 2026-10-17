import { useQueries, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AnswerBlockView } from "@maipai/ui/src/elements/answer-block";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { api, type WidgetData, type WidgetDescriptor } from "@/lib/api";

/** Design note section 6: never more than four Today cards before "More". */
export const TODAY_CARD_BUDGET = 4;

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
export function TodaySection() {
  const list = useQuery({ queryKey: ["widgets"], queryFn: api.widgets, retry: false });
  const widgets = Array.isArray(list.data) ? list.data : [];
  const results = useQueries({
    queries: widgets.map((widget) => ({
      queryKey: ["widget-data", widget.package, widget.id],
      queryFn: () => api.widgetData(widget.package, widget.id),
      refetchInterval: Math.max(widget.refresh_s, 30) * 1000,
      retry: false,
    })),
  });
  const slots = todaySlots(widgets, results);

  if (list.isPending) return <RouteSkeleton label="Loading Today" />;
  if (slots.length === 0) return null;

  const cards = (shown: Slot[]) => shown.map((slot) => slot.data.card ? (
    // The kit's compact weather card is its own card; the text Card is the fallback when no block came back.
    <div key={`${slot.widget.package}/${slot.widget.id}`} data-testid="home-today-card">
      <AnswerBlockView block={slot.data.card} compact />
    </div>
  ) : (
    <Card key={`${slot.widget.package}/${slot.widget.id}`} size="sm" data-testid="home-today-card">
      <CardHeader><CardTitle>{slot.widget.title}</CardTitle></CardHeader>
      <CardContent>
        <ItemGroup>
          {slot.data.items.map((item, index) => (
            <Item key={`${item.title}-${index}`} size="sm">
              <ItemContent>
                <ItemTitle>{item.title}</ItemTitle>
                {item.subtitle ? <ItemDescription>{item.subtitle}</ItemDescription> : null}
              </ItemContent>
              {item.value ? <ItemActions>{item.value}</ItemActions> : null}
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  ));

  const first = slots.slice(0, TODAY_CARD_BUDGET);
  const rest = slots.slice(TODAY_CARD_BUDGET);
  return (
    <section aria-label="Today" className="flex flex-col gap-3">
      <h2 className="text-base leading-snug font-medium">Today</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards(first)}</div>
      {rest.length === 0 ? null : (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>More</CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-4 pt-3 sm:grid-cols-2 lg:grid-cols-3">{cards(rest)}</div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
