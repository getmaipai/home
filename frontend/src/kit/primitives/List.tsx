import type { ReactNode } from "react";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { cn, FOCUS_RING } from "@/kit/utils";

interface ListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  /** The row's contents only. The list owns the row surface, the
   * dividers, the touch target and the focus ring. */
  renderItem: (item: T) => ReactNode;
  /** Given, every row becomes a button. */
  onSelect?: (item: T) => void;
  /** Accessible name for a row, needed when the row's own content has no
   * readable text (an avatar and a status dot, say). */
  getLabel?: (item: T) => string;
  isSelected?: (item: T) => boolean;
  /** A trailing control per row (an overflow menu, a switch). Rendered
   * outside the row button, because a control inside a button is not
   * reachable and not valid HTML. */
  renderAction?: (item: T) => ReactNode;
  /** Accessible name for the list as a whole. */
  label?: string;
  emptyState?: { icon: string; text: string };
  /** Hairlines between rows. On by default: a list of text rows with no
   * separator reads as one block of prose. */
  dividers?: boolean;
}

// docs/UI.md names List as one of the kit's generic primitives. The
// vertical counterpart to CardGrid, with the same content-agnostic
// shape: items plus a renderer, no knowledge of what is in them. One
// column at every surface by design - a list that reflows into columns
// is a CardGrid, and having exactly one answer per pattern is the point
// of the kit ("patterns: one way to do each thing").
export function List<T>({
  items,
  getKey,
  renderItem,
  onSelect,
  getLabel,
  isSelected,
  renderAction,
  label,
  emptyState,
  dividers = true,
}: ListProps<T>) {
  if (items.length === 0 && emptyState) {
    return <EmptyState icon={emptyState.icon} text={emptyState.text} />;
  }

  return (
    <ul
      aria-label={label}
      className={cn(
        "flex list-none flex-col p-0",
        dividers && "divide-y divide-[hsl(var(--border))]",
      )}
    >
      {items.map((item) => {
        const selected = isSelected?.(item) ?? false;
        const content = (
          <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">{renderItem(item)}</div>
        );
        return (
          <li key={getKey(item)} className="flex min-w-0 items-center gap-1">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-label={getLabel?.(item)}
                aria-current={selected ? "true" : undefined}
                // 48px minimum target, visible focus ring: docs/UI.md's
                // floor, WCAG 2.2 AA 2.5.5 and 2.4.13.
                className={cn(
                  "flex min-h-12 min-w-0 flex-1 items-center rounded-[var(--radius)] text-left",
                  "hover:bg-[hsl(var(--muted))]",
                  FOCUS_RING,
                  selected && "bg-[hsl(var(--muted))]",
                )}
              >
                {content}
              </button>
            ) : (
              <div className="flex min-h-12 min-w-0 flex-1 items-center">{content}</div>
            )}
            {renderAction ? <div className="shrink-0 pr-2">{renderAction(item)}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
