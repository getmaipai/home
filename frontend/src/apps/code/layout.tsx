// CODE-APP-01: the page's own spacing, kept apart from the kit Elements it holds (rule 9: an Element is never wrapped or restyled; the page lays them out).
import type { ComponentProps, ElementType } from "react";

type StackProps = ComponentProps<"div"> & { as?: ElementType; row?: boolean; gap?: "none" | "tight" | "normal" };

/** A flex column (or row) with a gap. Draws no surface, border or colour of its own. */
export function Stack({ as: Tag = "div", row = false, gap = "normal", className = "", ...props }: StackProps) {
  return <Tag className={`flex ${row ? "flex-row" : "flex-col"} ${gap === "none" ? "" : gap === "tight" ? "gap-1" : "gap-3"} ${className}`.trim()} {...props} />;
}
