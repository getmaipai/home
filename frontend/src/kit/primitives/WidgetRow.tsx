import { Card } from "@/kit/primitives/Card";
import { Skeleton } from "@/kit/ui/skeleton";
import { getIcon } from "@/kit/icons";
import type { WidgetItem } from "@/lib/api";

interface WidgetRowProps {
  title: string;
  items: WidgetItem[] | undefined;
  isLoading: boolean;
}

function RowItem({ item }: { item: WidgetItem }) {
  const Icon = item.icon ? getIcon(item.icon) : null;
  return (
    <li className="flex shrink-0 items-center gap-1.5">
      {Icon ? <Icon aria-hidden className="size-4 text-muted-foreground" /> : null}
      <span className="text-base">{item.title}</span>
      {item.value ? <span className="text-sm text-muted-foreground">{item.value}</span> : null}
    </li>
  );
}

// The "row"-size half of a widget (widget_row): a slim, full-width strip
// rather than a sized grid tile - no card-size slider applies here, a
// row's height doesn't scale the way a grid of tiles does. Items render
// inline (icon, title, value), separated, rather than each on its own
// line - a row widget is meant to be glanced at, not read line by line.
// Not the kit's `List` (WidgetCard.tsx's own choice for its vertical
// item stack): List is "the vertical counterpart to CardGrid... one
// column at every surface by design" (its own header comment) - a
// horizontal, single-line strip is a genuinely different layout, not
// the same list done twice.
export function WidgetRow({ title, items, isLoading }: WidgetRowProps) {
  return (
    <Card label={title} className="flex items-center gap-3 p-3">
      <span className="shrink-0 text-sm font-medium text-muted-foreground">{title}</span>
      {isLoading ? (
        <Skeleton className="h-4 flex-1" />
      ) : !items || items.length === 0 ? (
        <span className="text-sm text-muted-foreground">Nothing here yet.</span>
      ) : (
        <ul className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto">
          {items.map((item, i) => (
            <RowItem key={i} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}
