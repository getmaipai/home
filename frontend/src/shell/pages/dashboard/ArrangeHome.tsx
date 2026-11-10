import { i18n } from "@lingui/core";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { errorLine } from "@/lib/hubReachability";
import { api, type ArrangeCard, type WidgetDescriptor } from "@/lib/api";

const ArrowDown = getIcon("arrow-down");
const ArrowUp = getIcon("arrow-up");
const SlidersHorizontal = getIcon("sliders-horizontal");

export const ARRANGE_KEY = ["home-arrange"] as const;

/** The name a Home card goes by on screen (a few package titles read better in plain words). */
export const displayTitle = (widget: Pick<WidgetDescriptor, "package" | "id" | "title">) => widget.package === "almanac-date" && widget.id === "today" ? i18n._({ id: "Coming up", message: "Coming up" })
  : widget.package === "remind" && widget.id === "upcoming" ? i18n._({ id: "Next up", message: "Next up" })
  : widget.package === "timer" && widget.id === "running" ? i18n._({ id: "Timers", message: "Timers" })
  : widget.title;

/** The order and hidden list to save for a row list, and the list after moving one row by `delta` (pure, for tests). */
export function moveCard(cards: ArrangeCard[], index: number, delta: -1 | 1): ArrangeCard[] {
  const target = index + delta;
  if (index < 0 || target < 0 || index >= cards.length || target >= cards.length) return cards;
  const next = [...cards];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** The first row is the Home highlight while it is shown; it stays first, so nothing swaps with it. */
const isPinned = (cards: ArrangeCard[], index: number) => index === 0 && Boolean(cards[0]?.hero) && !cards[0]?.hidden;

/** The quiet "Arrange" entry in Home's Today header and the sheet it opens: show or hide each card, move it up or down, or go back to the default. */
export function ArrangeHome() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ARRANGE_KEY, queryFn: api.homeArrange, retry: false, enabled: open });
  const save = useMutation({
    mutationFn: (input: { order: string[]; hidden: string[] }) => api.saveHomeArrange(input.order, input.hidden),
    onSuccess: (saved) => {
      setError(null);
      queryClient.setQueryData(ARRANGE_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: ["home-widgets"] });
      void queryClient.invalidateQueries({ queryKey: ["home-hero"] });
    },
    onError: (e) => setError(errorLine(e, i18n._({ id: "Could not save your Home layout. Check your connection and try again.", message: "Could not save your Home layout. Check your connection and try again." }))),
  });
  const cards = list.data?.cards ?? [];
  const submit = (next: ArrangeCard[]) => save.mutate({ order: next.map((card) => card.key), hidden: next.filter((card) => card.hidden).map((card) => card.key) });

  return (
    <>
      <Button variant="ghost" size="row" data-testid="home-arrange-open" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden />
        {i18n._({ id: "Arrange", message: "Arrange" })}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{i18n._({ id: "Arrange Home", message: "Arrange Home" })}</SheetTitle>
            <SheetDescription>{i18n._({ id: "Choose which cards show on Home and the order they come in.", message: "Choose which cards show on Home and the order they come in." })}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 overflow-y-auto px-4" data-testid="home-arrange-list">
            {list.isPending && open ? <RouteSkeleton label={i18n._({ id: "Loading your cards", message: "Loading your cards" })} /> : null}
            {list.isError ? <StatusCard kind="problem" stateWord={i18n._({ id: "Could not load", message: "Could not load" })} title={i18n._({ id: "Your cards did not load", message: "Your cards did not load" })} line={errorLine(list.error, i18n._({ id: "Close this and open Arrange again.", message: "Close this and open Arrange again." }))} action={{ label: i18n._({ id: "Try again", message: "Try again" }), onSelect: () => { void list.refetch(); } }} /> : null}
            {error ? <StatusCard kind="problem" stateWord={i18n._({ id: "Could not save", message: "Could not save" })} title={i18n._({ id: "Your change was not saved", message: "Your change was not saved" })} line={error} /> : null}
            {list.data && cards.length === 0 ? <p className="text-supporting text-muted-foreground" data-testid="home-arrange-empty">{i18n._({ id: "There are no cards to arrange yet. They appear here as soon as Home has something to show.", message: "There are no cards to arrange yet. They appear here as soon as Home has something to show." })}</p> : null}
            {cards.length > 0 ? (
              <ItemGroup>
                {cards.map((card, index) => {
                  const title = displayTitle(card);
                  return (
                    <Item key={card.key} size="sm" role="listitem" data-testid="home-arrange-row" data-hidden={card.hidden ? "true" : undefined}>
                      <ItemContent><ItemTitle>{title}</ItemTitle></ItemContent>
                      <ItemActions>
                        <Button variant="ghost" size="icon-sm" aria-label={i18n._({ id: "Move {title} up", message: "Move {title} up", values: { title } })} disabled={index === 0 || isPinned(cards, index - 1) || save.isPending} onClick={() => submit(moveCard(cards, index, -1))}><ArrowUp aria-hidden /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={i18n._({ id: "Move {title} down", message: "Move {title} down", values: { title } })} disabled={index === cards.length - 1 || isPinned(cards, index) || save.isPending} onClick={() => submit(moveCard(cards, index, 1))}><ArrowDown aria-hidden /></Button>
                        <Switch aria-label={i18n._({ id: "Show {title} on Home", message: "Show {title} on Home", values: { title } })} checked={!card.hidden} disabled={save.isPending} onCheckedChange={(shown) => submit(cards.map((c) => c.key === card.key ? { ...c, hidden: !shown } : c))} />
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
            ) : null}
          </div>
          <SheetFooter>
            <Button variant="outline" data-testid="home-arrange-reset" disabled={save.isPending} onClick={() => save.mutate({ order: [], hidden: [] })}>{i18n._({ id: "Reset to default", message: "Reset to default" })}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
