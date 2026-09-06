import type { ReactNode } from "react";

interface SectionProps {
  heading?: string;
  /** Step 7's tree sidebar scrolls to a section by id (`element.
   * scrollIntoView`) rather than the tree owning a second copy of each
   * section's content. */
  id?: string;
  children: ReactNode;
}

// A design review (2026-09-05) on the running Settings page: quiet
// 11px grey headings with a 1px rule gave the eye nothing to anchor on
// while scrolling a long page, and two unrelated sections rendered
// back to back read as one broken, duplicated group rather than two
// distinct ones. A real card surface (border, background, padding) is
// the fix, in one place: every page that composes from `Section` -
// Settings' groups and Memory's schema-driven sections alike - gets a
// visible boundary for free.
export function Section({ heading, id, children }: SectionProps) {
  return (
    <section id={id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 scroll-mt-4">
      {heading ? (
        // A thin brand-colored left rule beside the heading, not the
        // whole card - the same restrained accent placement Jesse's own
        // reference screenshot used for a highlighted settings row,
        // rather than a full colored header bar competing with the
        // card's own border. Bumped to match `Page.tsx`'s own bolder
        // title scale (2026-09-06 visual pass): a section heading this
        // size reads as a real heading on its own, not just a slightly
        // heavier line of body text.
        <h2 className="border-l-2 border-primary pl-2 text-lg font-bold text-foreground">{heading}</h2>
      ) : null}
      {children}
    </section>
  );
}
