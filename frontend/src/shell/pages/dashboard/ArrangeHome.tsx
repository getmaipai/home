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
import { api, type ArrangeCard, type HomeSectionLayout, type WidgetDescriptor } from "@/lib/api";
import { homeBlocks } from "@/shell/pages/dashboard/homeBlocks";

const ArrowDown = getIcon("arrow-down");
const ArrowUp = getIcon("arrow-up");
const SlidersHorizontal = getIcon("sliders-horizontal");

export const ARRANGE_KEY = ["home-arrange"] as const;
export const HOME_SECTIONS = ["hero", "composer", "make", "continue", "today", "new", "made", "family", "admin"] as const;
export type HomeSection = typeof HOME_SECTIONS[number];
const SECTION_LABELS: Record<HomeSection, string> = { hero: "Hero", composer: "Composer", make: "Make", continue: "Continue", today: "Today", new: "New in your library", made: "Made at home", family: "Family and companions", admin: "Admin" };
export const sectionTitle = (id: HomeSection) => i18n._({ id: SECTION_LABELS[id], message: SECTION_LABELS[id] });
export function defaultSectionLayout(role: string, layout: "ask" | "board" | "shelves"): HomeSectionLayout & { order: string[]; hidden: string[] } {
  const blockToSection: Record<string, HomeSection> = { hero: "hero", ask: "composer", make: "make", pick_up: "continue", today: "today", today_chips: "today", media_continue: "continue", media_new: "new", media_made: "made", family: "family", admin: "admin", getting_started: "admin" };
  const order: HomeSection[] = [...new Set(homeBlocks(layout).map((block): HomeSection | undefined => blockToSection[block]).filter((id): id is HomeSection => Boolean(id)))];
  for (const id of HOME_SECTIONS) if (!order.includes(id)) order.push(id);
  const hidden: string[] = role === "child" ? ["admin"] : role === "teen" ? ["admin"] : [];
  return { order, hidden, heroSource: role === "child" || role === "teen" ? "companion" : "made" };
}

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
export function moveSection<T extends string>(sections: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta; if (index < 0 || target < 0 || index >= sections.length || target >= sections.length) return sections;
  const next = [...sections]; [next[index], next[target]] = [next[target]!, next[index]!]; return next;
}

/** The first row is the Home highlight while it is shown; it stays first, so nothing swaps with it. */
const isPinned = (cards: ArrangeCard[], index: number) => index === 0 && Boolean(cards[0]?.hero) && !cards[0]?.hidden;

/** The quiet "Arrange" entry in Home's Today header and the sheet it opens: show or hide each card, move it up or down, or go back to the default. */
export function ArrangeHome({ role = "adult", layout = "shelves" }: { role?: string; layout?: "ask" | "board" | "shelves" }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ARRANGE_KEY, queryFn: api.homeArrange, retry: false, enabled: open });
  const save = useMutation({
    mutationFn: (input: { order: string[]; hidden: string[]; sections?: HomeSectionLayout }) => api.saveHomeArrange(input.order, input.hidden, input.sections),
    onSuccess: (saved) => {
      setError(null);
      queryClient.setQueryData(ARRANGE_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: ["home-widgets"] });
      void queryClient.invalidateQueries({ queryKey: ["home-hero"] });
    },
    onError: (e) => setError(errorLine(e, i18n._({ id: "Could not save your Home layout. Check your connection and try again.", message: "Could not save your Home layout. Check your connection and try again." }))),
  });
  const cards = list.data?.cards ?? [];
  const defaults = defaultSectionLayout(role, layout);
  const sectionLayout = list.data?.sections ?? defaults;
  const sectionOrder = [...(sectionLayout.order ?? defaults.order), ...HOME_SECTIONS.filter((id) => !(sectionLayout.order ?? defaults.order).includes(id))];
  const hiddenSections = sectionLayout.hidden ?? defaults.hidden;
  const submit = (next: ArrangeCard[], sections: HomeSectionLayout = sectionLayout) => save.mutate({ order: next.map((card) => card.key), hidden: next.filter((card) => card.hidden).map((card) => card.key), sections });
  const submitSections = (sections: HomeSectionLayout) => submit(cards, sections);

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
          <SheetDescription>{i18n._({ id: "Choose which sections show on Home and the order they come in.", message: "Choose which sections show on Home and the order they come in." })}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 overflow-y-auto px-4" data-testid="home-arrange-list">
            {list.isPending && open ? <RouteSkeleton label={i18n._({ id: "Loading your cards", message: "Loading your cards" })} /> : null}
            {list.isError ? <StatusCard kind="problem" stateWord={i18n._({ id: "Could not load", message: "Could not load" })} title={i18n._({ id: "Your cards did not load", message: "Your cards did not load" })} line={errorLine(list.error, i18n._({ id: "Close this and open Arrange again.", message: "Close this and open Arrange again." }))} action={{ label: i18n._({ id: "Try again", message: "Try again" }), onSelect: () => { void list.refetch(); } }} /> : null}
            {error ? <StatusCard kind="problem" stateWord={i18n._({ id: "Could not save", message: "Could not save" })} title={i18n._({ id: "Your change was not saved", message: "Your change was not saved" })} line={error} /> : null}
            <ItemGroup>
              {sectionOrder.map((id, index) => {
                const section = id as HomeSection; const title = sectionTitle(section);
                return <Item key={section} size="sm" role="listitem" data-testid="home-arrange-section"><ItemContent><ItemTitle>{title}</ItemTitle></ItemContent><ItemActions>
                  <Button variant="ghost" size="row" aria-label={i18n._({ id: "Move section {title} up", message: "Move section {title} up", values: { title } })} disabled={index === 0 || save.isPending} onClick={() => submitSections({ ...sectionLayout, order: moveSection(sectionOrder, index, -1) })}><ArrowUp aria-hidden /></Button>
                  <Button variant="ghost" size="row" aria-label={i18n._({ id: "Move section {title} down", message: "Move section {title} down", values: { title } })} disabled={index === sectionOrder.length - 1 || save.isPending} onClick={() => submitSections({ ...sectionLayout, order: moveSection(sectionOrder, index, 1) })}><ArrowDown aria-hidden /></Button>
                  <Switch aria-label={i18n._({ id: "Show section {title}", message: "Show section {title}", values: { title } })} checked={!hiddenSections.includes(section)} disabled={save.isPending} onCheckedChange={(shown) => submitSections({ ...sectionLayout, hidden: shown ? hiddenSections.filter((entry) => entry !== section) : [...hiddenSections, section] })} />
                </ItemActions></Item>;
              })}
            </ItemGroup>
            <label className="flex items-center gap-3 px-2 py-2 text-supporting">{i18n._({ id: "Hero source", message: "Hero source" })}<select aria-label={i18n._({ id: "Hero source", message: "Hero source" })} value={sectionLayout.heroSource ?? defaults.heroSource} disabled={save.isPending} onChange={(event) => submitSections({ ...sectionLayout, heroSource: event.currentTarget.value as HomeSectionLayout["heroSource"] })}><option value="made">{i18n._({ id: "Made at home", message: "Made at home" })}</option><option value="companion">{i18n._({ id: "Companion", message: "Companion" })}</option><option value="off">{i18n._({ id: "Off", message: "Off" })}</option></select></label>
            {cards.length > 0 ? (
              <ItemGroup>
                {cards.map((card, index) => {
                  const title = displayTitle(card);
                  return (
                    <Item key={card.key} size="sm" role="listitem" data-testid="home-arrange-row" data-hidden={card.hidden ? "true" : undefined}>
                      <ItemContent><ItemTitle>{title}</ItemTitle></ItemContent>
                      <ItemActions>
                        <Button variant="ghost" size="row" aria-label={i18n._({ id: "Move {title} up", message: "Move {title} up", values: { title } })} disabled={index === 0 || isPinned(cards, index - 1) || save.isPending} onClick={() => submit(moveCard(cards, index, -1))}><ArrowUp aria-hidden /></Button>
                        <Button variant="ghost" size="row" aria-label={i18n._({ id: "Move {title} down", message: "Move {title} down", values: { title } })} disabled={index === cards.length - 1 || isPinned(cards, index) || save.isPending} onClick={() => submit(moveCard(cards, index, 1))}><ArrowDown aria-hidden /></Button>
                        <Switch aria-label={i18n._({ id: "Show {title} on Home", message: "Show {title} on Home", values: { title } })} checked={!card.hidden} disabled={save.isPending} onCheckedChange={(shown) => submit(cards.map((c) => c.key === card.key ? { ...c, hidden: !shown } : c))} />
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
            ) : null}
          </div>
          <SheetFooter>
            <Button variant="outline" data-testid="home-arrange-reset" disabled={save.isPending} onClick={() => save.mutate({ order: [], hidden: [], sections: defaults })}>{i18n._({ id: "Reset to default", message: "Reset to default" })}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
