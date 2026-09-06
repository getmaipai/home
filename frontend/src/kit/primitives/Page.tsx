import type { ReactNode } from "react";

interface PageProps {
  title: string;
  /** A design review (2026-09-05) found Settings starting straight into
   * "System" with nothing to say what page this is - the `h1` existed
   * but was `sr-only`, so nobody actually saw it. Visible by default;
   * `hideTitle` is the escape hatch for a page whose own content already
   * makes the destination obvious (nothing uses it yet). */
  hideTitle?: boolean;
  children: ReactNode;
}

// docs/UI.md: "pages are data... a page has id/title/body[]." The shell
// owns the chrome around this (Shell.tsx); Page is just the body
// container every app's page renders into, one column on phone/tablet
// today (the kit's density budget - 1/2/3 columns phone/tablet/desktop -
// has nothing to split into yet with exactly one page in the whole app).
export function Page({ title, hideTitle, children }: PageProps) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <h1 className={hideTitle ? "sr-only" : "px-4 pt-5 pb-1 text-3xl font-bold tracking-tight"}>{title}</h1>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
