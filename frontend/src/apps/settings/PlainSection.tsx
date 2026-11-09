import type { ReactNode } from "react";

/** The PRO look for a page-level group: no card, no accent bar, a semantic section heading (or none when the page header already names it). */
export function PlainSection({ heading, id, children }: { heading?: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-4">
      {heading ? <h2 className="text-section font-semibold">{heading}</h2> : null}
      {children}
    </section>
  );
}
