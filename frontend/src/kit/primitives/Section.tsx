import type { ReactNode } from "react";

interface SectionProps {
  heading?: string;
  children: ReactNode;
}

export function Section({ heading, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-2">
      {heading ? (
        <h2 className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">{heading}</h2>
      ) : null}
      {children}
    </section>
  );
}
