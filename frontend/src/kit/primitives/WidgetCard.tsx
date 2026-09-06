import { Card } from "@/kit/primitives/Card";
import { List } from "@/kit/primitives/List";
import { Skeleton } from "@/kit/ui/skeleton";
import { getIcon } from "@/kit/icons";
import type { WidgetItem } from "@/lib/api";

function WidgetItemRow({ item }: { item: WidgetItem }) {
  const Icon = item.icon ? getIcon(item.icon) : null;
  const content = (
    <div className="flex min-w-0 items-center gap-2">
      {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
      {item.image ? <img src={item.image} alt="" className="size-8 shrink-0 rounded object-cover" /> : null}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-base">{item.title}</span>
        {item.subtitle ? <span className="truncate text-sm text-muted-foreground">{item.subtitle}</span> : null}
      </div>
      {item.value ? <span className="ml-auto shrink-0 text-base font-medium">{item.value}</span> : null}
    </div>
  );
  // A widget's own href is server data (D's package cache), never
  // page-authored - the schema's own `action.navigate` isn't reused here
  // since that always targets a `page.id` this app knows about, not an
  // arbitrary URL a package hands back. A plain anchor is honest about
  // that: same-origin routes still work (a full navigation, not an SPA
  // one - acceptable for a first pass with no widget yet producing one).
  // Not `List`'s own `onSelect` (that makes the whole row a button for
  // every item, but only some items carry an href).
  return item.href ? (
    <a href={item.href} className="block rounded p-1 hover:bg-accent">
      {content}
    </a>
  ) : (
    <div className="p-1">{content}</div>
  );
}

interface WidgetCardProps {
  title: string;
  items: WidgetItem[] | undefined;
  isLoading: boolean;
}

// The "card"-size half of a widget (spec/ui/schema.json's widget_card
// node): one package's own small today-card, drawn with the kit's one
// card surface like every other card in the app. Content-agnostic same
// as CardGrid/MediaShelf - the interpreter (NodeRenderer.tsx) owns the
// fetch and the per-widget refresh_s poll, this just draws what it's
// given. Uses the kit's own `List` for the item rows (a code review,
// 2026-09-06, found a hand-rolled `<ul>/<li>` reimplementing what List
// already owns) - not `List`'s own `emptyState`, since that renders the
// kit's full-page `EmptyState` (a big centered icon and an 8-unit
// padding block), sized for a whole page or section being empty, not a
// single small card in a grid; the empty case here stays a plain line.
export function WidgetCard({ title, items, isLoading }: WidgetCardProps) {
  return (
    <Card label={title} className="flex h-full flex-col gap-2 p-4">
      <span className="text-sm font-medium text-muted-foreground">{title}</span>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : !items || items.length === 0 ? (
        <span className="text-sm text-muted-foreground">Nothing here yet.</span>
      ) : (
        <List
          items={items.map((item, i) => ({ item, key: String(i) }))}
          getKey={(row) => row.key}
          dividers={false}
          renderItem={(row) => <WidgetItemRow item={row.item} />}
        />
      )}
    </Card>
  );
}
