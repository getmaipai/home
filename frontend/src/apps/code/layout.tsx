// CODE-APP-01: the page's own spacing, kept apart from the kit Elements it holds (rule 9: an Element is never wrapped or restyled; the page lays them out).
import type { ComponentProps, CSSProperties, ElementType } from "react";

type StackProps = ComponentProps<"div"> & { as?: ElementType; row?: boolean; gap?: "none" | "tight" | "normal" };

/** A flex column (or row) with a gap. Draws no surface, border or colour of its own. */
export function Stack({ as: Tag = "div", row = false, gap = "normal", className = "", ...props }: StackProps) {
  return <Tag className={`flex ${row ? "flex-row" : "flex-col"} ${gap === "none" ? "" : gap === "tight" ? "gap-1" : "gap-3"} ${className}`.trim()} {...props} />;
}

/** The Code app draws every line of text at one size, the size of the agent's reply (design: compact, even, quiet). The type scale tokens the kit's text utilities read
 *  all take that one value, so no Element is restyled (rule 9). A phone keeps the 16px floor (docs/UI.md); a wider screen reads 14px. Spacing is tightened by token too. */
export function codeDensity(phone: boolean): CSSProperties {
  const size = phone ? "16px" : "14px";
  const vars: Record<string, string> = { "--font-size-body": size, "--settings-column-title-size": size, "--spacing": "calc(0.25rem * 0.8)", fontSize: size };
  for (const step of ["xs", "sm", "base", "lg", "xl", "2xl"]) vars[`--text-${step}`] = size;
  for (const step of ["title", "section", "row", "supporting", "badge", "hero"]) vars[`--font-size-${step}`] = size;
  return vars as CSSProperties;
}
