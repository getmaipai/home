import type { ReactNode } from "react";
import { Card } from "@/kit/components/Card";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { GRID_COLUMNS, type Density } from "@/kit/responsive";
import { cn } from "@/kit/utils";

interface CardGridProps<T> {
  items: readonly T[];
  /** Stable identity for each item. Required rather than inferred: an
   * array index as a key silently corrupts the grid the first time a
   * caller sorts or filters it. */
  getKey: (item: T) => string;
  /** The card's contents only. The grid owns the card surface, the
   * columns and the focus ring; a package that draws its own card here
   * is the thing docs/UI.md forbids. */
  renderItem: (item: T) => ReactNode;
  /** Given, every card becomes a button. `getLabel` names it, needed
   * when a card renders an image with no text of its own. */
  onSelect?: (item: T) => void;
  getLabel?: (item: T) => string;
  isSelected?: (item: T) => boolean;
  density?: Density;
  /** Accessible name for the grid as a whole. */
  label?: string;
  emptyState?: { icon: string; text: string };
}

// docs/UI.md names CardGrid as one of the kit's generic primitives that
// an app's pages are composed from ("pages are data"). Content-agnostic
// on purpose: it takes items and a renderer the way a component library
// would, and knows nothing about videos, people or packages. The column
// count is the kit's density budget (@/kit/responsive), not a prop, so a
// package never writes a breakpoint.
//
// No matching node exists in spec/ui/schema.json yet - v0 covers only
// what the Chat page needed, and the schema says the rest arrive "when
// those pages are tackled". This is the React half, ahead of the first
// app that needs it (docs/BACKLOG.md, UI / shell).
export function CardGrid<T>({
  items,
  getKey,
  renderItem,
  onSelect,
  getLabel,
  isSelected,
  density = "default",
  label,
  emptyState,
}: CardGridProps<T>) {
  if (items.length === 0 && emptyState) {
    return <EmptyState icon={emptyState.icon} text={emptyState.text} />;
  }

  return (
    <ul aria-label={label} className={cn("grid list-none gap-3 p-0", GRID_COLUMNS[density])}>
      {items.map((item) => (
        <li key={getKey(item)} className="min-w-0">
          <Card
            onSelect={onSelect ? () => onSelect(item) : undefined}
            label={getLabel?.(item)}
            selected={isSelected?.(item)}
            className="h-full"
          >
            {renderItem(item)}
          </Card>
        </li>
      ))}
    </ul>
  );
}
